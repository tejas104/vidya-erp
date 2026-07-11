import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, OrgPath, Role, ScopeGrant } from "@vidya/platform";
import { idnScopeGrants, idnUserRoles, idnUsers, type IdnUserRow } from "../db/schema";

export type UserStatus = "active" | "disabled" | "must_reset";

export interface UserRecord {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly collegeId: string;
  readonly createdAt: Date;
}

export type GrantSource = "manual" | "derived";

export interface StoredGrant {
  readonly id: string;
  readonly userId: string;
  readonly role: Role;
  readonly org: OrgPath;
  readonly subjectId?: string;
  readonly verified: boolean;
  readonly source: GrantSource;
  readonly sourceRef: string | null;
}

export interface NewGrant {
  readonly role: Role;
  readonly org: OrgPath;
  readonly subjectId?: string;
  readonly grantedBy: string;
  /** Defaults: manual, no sourceRef, unverified. */
  readonly source?: GrantSource;
  readonly sourceRef?: string;
  readonly verified?: boolean;
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username "${username}" is already taken`);
    this.name = "UsernameTakenError";
  }
}

export class RoleNotHeldError extends Error {
  constructor(role: Role) {
    super(`user does not hold role "${role}"`);
    this.name = "RoleNotHeldError";
  }
}

/**
 * Persistence port for identity. Services depend on this interface;
 * the Drizzle implementation below is exercised by the integration suite.
 */
export interface UsersRepo {
  create(user: {
    username: string;
    displayName: string;
    passwordHash: string;
    status: UserStatus;
    collegeId: string;
    roles: readonly Role[];
    createdBy: string | null;
  }): Promise<UserRecord>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  listByCollege(collegeId: string, limit: number, offset: number): Promise<UserRecord[]>;
  update(
    id: string,
    patch: { displayName?: string; status?: UserStatus },
  ): Promise<UserRecord | null>;
  updatePasswordHash(id: string, passwordHash: string, status: UserStatus): Promise<void>;
  getRoles(userId: string): Promise<Role[]>;
  /** Replaces the role set; revoked roles cascade away their grants (FK). */
  setRoles(userId: string, roles: readonly Role[], grantedBy: string): Promise<void>;
  /** Adds one role membership if absent (used by grant derivation, ADR-0015). */
  addRole(userId: string, role: Role, grantedBy: string): Promise<void>;
  getGrants(userId: string): Promise<StoredGrant[]>;
  getGrantById(grantId: string): Promise<StoredGrant | null>;
  findGrantBySourceRef(sourceRef: string): Promise<StoredGrant | null>;
  listGrantsBySourcePrefix(prefix: string): Promise<StoredGrant[]>;
  listUnverifiedGrants(): Promise<StoredGrant[]>;
  markGrantVerified(grantId: string): Promise<void>;
  addGrant(userId: string, grant: NewGrant): Promise<StoredGrant>;
  removeGrant(userId: string, grantId: string): Promise<boolean>;
  countAdmins(): Promise<number>;
}

function toRecord(row: IdnUserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    status: row.status as UserStatus,
    collegeId: row.collegeId,
    createdAt: row.createdAt,
  };
}

function toStoredGrant(row: typeof idnScopeGrants.$inferSelect): StoredGrant {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role as Role,
    org: {
      collegeId: row.collegeId,
      ...(row.departmentId !== null ? { departmentId: row.departmentId } : {}),
      ...(row.classId !== null ? { classId: row.classId } : {}),
      ...(row.sectionId !== null ? { sectionId: row.sectionId } : {}),
    },
    ...(row.subjectId !== null ? { subjectId: row.subjectId } : {}),
    verified: row.verified,
    source: row.source as GrantSource,
    sourceRef: row.sourceRef,
  };
}

export function grantToScopeGrant(grant: StoredGrant): ScopeGrant {
  return {
    role: grant.role,
    org: grant.org,
    ...(grant.subjectId !== undefined ? { subjectId: grant.subjectId } : {}),
  };
}

function pgErrorCode(error: unknown): string | undefined {
  // drizzle >=0.44 wraps driver errors in DrizzleQueryError; the pg code rides on .cause
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export function createUsersRepo(db: Db): UsersRepo {
  return {
    async create(user) {
      const id = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(idnUsers).values({
            id,
            username: user.username,
            displayName: user.displayName,
            passwordHash: user.passwordHash,
            status: user.status,
            collegeId: user.collegeId,
          });
          if (user.roles.length > 0) {
            await tx.insert(idnUserRoles).values(
              user.roles.map((role) => ({ userId: id, role, grantedBy: user.createdBy })),
            );
          }
        });
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new UsernameTakenError(user.username);
        }
        throw error;
      }
      const created = await this.findById(id);
      if (created === null) {
        throw new Error("user vanished immediately after creation");
      }
      return created;
    },

    async findByUsername(username) {
      const rows = await db
        .select()
        .from(idnUsers)
        .where(sql`lower(${idnUsers.username}) = lower(${username})`)
        .limit(1);
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async findById(id) {
      const rows = await db.select().from(idnUsers).where(eq(idnUsers.id, id)).limit(1);
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async listByCollege(collegeId, limit, offset) {
      const rows = await db
        .select()
        .from(idnUsers)
        .where(eq(idnUsers.collegeId, collegeId))
        .orderBy(asc(idnUsers.username))
        .limit(limit)
        .offset(offset);
      return rows.map(toRecord);
    },

    async update(id, patch) {
      const rows = await db
        .update(idnUsers)
        .set({
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(idnUsers.id, id))
        .returning();
      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async updatePasswordHash(id, passwordHash, status) {
      await db
        .update(idnUsers)
        .set({ passwordHash, status, updatedAt: new Date() })
        .where(eq(idnUsers.id, id));
    },

    async getRoles(userId) {
      const rows = await db
        .select({ role: idnUserRoles.role })
        .from(idnUserRoles)
        .where(eq(idnUserRoles.userId, userId))
        .orderBy(asc(idnUserRoles.role));
      return rows.map((row) => row.role as Role);
    },

    async setRoles(userId, roles, grantedBy) {
      await db.transaction(async (tx) => {
        await tx.delete(idnUserRoles).where(eq(idnUserRoles.userId, userId));
        if (roles.length > 0) {
          await tx.insert(idnUserRoles).values(
            roles.map((role) => ({ userId, role, grantedBy })),
          );
        }
      });
    },

    async addRole(userId, role, grantedBy) {
      await db
        .insert(idnUserRoles)
        .values({ userId, role, grantedBy })
        .onConflictDoNothing();
    },

    async getGrants(userId) {
      const rows = await db
        .select()
        .from(idnScopeGrants)
        .where(eq(idnScopeGrants.userId, userId))
        .orderBy(asc(idnScopeGrants.createdAt));
      return rows.map(toStoredGrant);
    },

    async getGrantById(grantId) {
      const rows = await db
        .select()
        .from(idnScopeGrants)
        .where(eq(idnScopeGrants.id, grantId))
        .limit(1);
      return rows[0] === undefined ? null : toStoredGrant(rows[0]);
    },

    async findGrantBySourceRef(sourceRef) {
      const rows = await db
        .select()
        .from(idnScopeGrants)
        .where(eq(idnScopeGrants.sourceRef, sourceRef))
        .limit(1);
      return rows[0] === undefined ? null : toStoredGrant(rows[0]);
    },

    async listGrantsBySourcePrefix(prefix) {
      const rows = await db
        .select()
        .from(idnScopeGrants)
        .where(sql`${idnScopeGrants.sourceRef} LIKE ${`${prefix}%`}`)
        .orderBy(asc(idnScopeGrants.createdAt));
      return rows.map(toStoredGrant);
    },

    async listUnverifiedGrants() {
      const rows = await db
        .select()
        .from(idnScopeGrants)
        .where(eq(idnScopeGrants.verified, false))
        .orderBy(asc(idnScopeGrants.createdAt));
      return rows.map(toStoredGrant);
    },

    async markGrantVerified(grantId) {
      await db
        .update(idnScopeGrants)
        .set({ verified: true })
        .where(eq(idnScopeGrants.id, grantId));
    },

    async addGrant(userId, grant) {
      const id = randomUUID();
      const source = grant.source ?? "manual";
      try {
        await db.insert(idnScopeGrants).values({
          id,
          userId,
          role: grant.role,
          collegeId: grant.org.collegeId,
          departmentId: grant.org.departmentId ?? null,
          classId: grant.org.classId ?? null,
          sectionId: grant.org.sectionId ?? null,
          subjectId: grant.subjectId ?? null,
          verified: grant.verified ?? false,
          source,
          sourceRef: grant.sourceRef ?? null,
          grantedBy: grant.grantedBy,
        });
      } catch (error) {
        if (pgErrorCode(error) === "23503") {
          throw new RoleNotHeldError(grant.role);
        }
        throw error;
      }
      return {
        id,
        userId,
        role: grant.role,
        org: grant.org,
        ...(grant.subjectId !== undefined ? { subjectId: grant.subjectId } : {}),
        verified: grant.verified ?? false,
        source,
        sourceRef: grant.sourceRef ?? null,
      };
    },

    async removeGrant(userId, grantId) {
      const rows = await db
        .delete(idnScopeGrants)
        .where(and(eq(idnScopeGrants.id, grantId), eq(idnScopeGrants.userId, userId)))
        .returning({ id: idnScopeGrants.id });
      return rows.length > 0;
    },

    async countAdmins() {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(idnUserRoles)
        .where(eq(idnUserRoles.role, "admin"));
      return rows[0]?.count ?? 0;
    },
  };
}
