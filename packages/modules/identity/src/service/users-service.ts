import type { AuditLogger, OrgDirectory, Role } from "@vidya/platform";
import type { PasswordHasher, SessionManager } from "../core/contracts";
import type {
  NewGrant,
  StoredGrant,
  UserRecord,
  UsersRepo,
} from "../repo/users-repo";

/** Thrown when a manual grant names org units the OrgDirectory cannot resolve (422 at the route). */
export class InvalidOrgPathError extends Error {
  constructor(reason: string) {
    super(`grant rejected: ${reason}`);
    this.name = "InvalidOrgPathError";
  }
}

/** Thrown when manual administration touches a derived grant (409 at the route, ADR-0015). */
export class DerivedGrantImmutableError extends Error {
  constructor() {
    super(
      "this grant is derived from a people-module teacher assignment; change the assignment instead",
    );
    this.name = "DerivedGrantImmutableError";
  }
}

export interface UserView {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly status: "active" | "disabled" | "must_reset";
  readonly collegeId: string;
  readonly roles: readonly Role[];
  readonly grants: readonly {
    readonly id: string;
    readonly role: Role;
    readonly collegeId: string;
    readonly departmentId: string | null;
    readonly classId: string | null;
    readonly sectionId: string | null;
    readonly subjectId: string | null;
    readonly verified: boolean;
    readonly source: "manual" | "derived";
  }[];
  readonly createdAt: string;
}

export interface UsersServiceDeps {
  readonly repo: UsersRepo;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionManager;
  readonly audit: AuditLogger;
  /**
   * Late-bound OrgDirectory (people module, #3). When present, manual
   * grants are validated against the real org tree and stored verified.
   */
  readonly orgDirectory?: () => OrgDirectory | null;
}

function grantView(grant: StoredGrant): UserView["grants"][number] {
  return {
    id: grant.id,
    role: grant.role,
    collegeId: grant.org.collegeId,
    departmentId: grant.org.departmentId ?? null,
    classId: grant.org.classId ?? null,
    sectionId: grant.org.sectionId ?? null,
    subjectId: grant.subjectId ?? null,
    verified: grant.verified,
    source: grant.source,
  };
}

/**
 * User administration (Fable-owned). Route handlers add the scope-check;
 * this service owns persistence choreography and the session-invalidation
 * rule: any change to a user's authority (roles, grants, status) kills
 * their sessions so stale privilege snapshots cannot outlive the change.
 */
export class UsersService {
  constructor(private readonly deps: UsersServiceDeps) {}

  private async toView(record: UserRecord): Promise<UserView> {
    const [roles, grants] = await Promise.all([
      this.deps.repo.getRoles(record.id),
      this.deps.repo.getGrants(record.id),
    ]);
    return {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      status: record.status,
      collegeId: record.collegeId,
      roles,
      grants: grants.map(grantView),
      createdAt: record.createdAt.toISOString(),
    };
  }

  /** New accounts start in must_reset: the temporary password cannot log in. */
  async createUser(input: {
    username: string;
    displayName: string;
    collegeId: string;
    temporaryPassword: string;
    roles: readonly Role[];
    createdBy: string;
  }): Promise<UserView> {
    const passwordHash = await this.deps.hasher.hash(input.temporaryPassword);
    const record = await this.deps.repo.create({
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      status: "must_reset",
      collegeId: input.collegeId,
      roles: input.roles,
      createdBy: input.createdBy,
    });
    return this.toView(record);
  }

  async getUser(userId: string): Promise<UserView | null> {
    const record = await this.deps.repo.findById(userId);
    return record === null ? null : this.toView(record);
  }

  async getUserRecord(userId: string): Promise<UserRecord | null> {
    return this.deps.repo.findById(userId);
  }

  async listUsers(collegeId: string, limit: number, offset: number): Promise<UserView[]> {
    const records = await this.deps.repo.listByCollege(collegeId, limit, offset);
    return Promise.all(records.map((record) => this.toView(record)));
  }

  async updateUser(
    userId: string,
    patch: { displayName?: string; status?: "active" | "disabled" },
  ): Promise<UserView | null> {
    const before = await this.deps.repo.findById(userId);
    if (before === null) {
      return null;
    }
    const updated = await this.deps.repo.update(userId, patch);
    if (updated === null) {
      return null;
    }
    if (patch.status === "disabled") {
      await this.deps.sessions.invalidateAllForUser(userId);
    }
    return this.toView(updated);
  }

  async setRoles(
    userId: string,
    roles: readonly Role[],
    actorId: string,
  ): Promise<{ before: Role[]; after: Role[] } | null> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return null;
    }
    const before = await this.deps.repo.getRoles(userId);
    await this.deps.repo.setRoles(userId, roles, actorId);
    const after = await this.deps.repo.getRoles(userId);
    await this.deps.sessions.invalidateAllForUser(userId);
    return { before, after };
  }

  /**
   * Throws RoleNotHeldError when the grant's role is not held (409) and
   * InvalidOrgPathError when the OrgDirectory rejects the org units (422).
   * With the directory wired, manual grants are stored verified.
   */
  async addGrant(userId: string, grant: NewGrant): Promise<StoredGrant | null> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return null;
    }
    const directory = this.deps.orgDirectory?.() ?? null;
    let verified = grant.verified ?? false;
    if (directory !== null) {
      const path = await directory.verifyOrgPath(grant.org);
      if (!path.valid) {
        throw new InvalidOrgPathError(path.reason ?? "org path does not resolve");
      }
      if (grant.subjectId !== undefined && !(await directory.verifySubjectId(grant.subjectId))) {
        throw new InvalidOrgPathError(`unknown subjectId "${grant.subjectId}"`);
      }
      verified = true;
    }
    const stored = await this.deps.repo.addGrant(userId, { ...grant, verified });
    await this.deps.sessions.invalidateAllForUser(userId);
    return stored;
  }

  /** Throws DerivedGrantImmutableError for derived grants (409) — change the assignment instead. */
  async removeGrant(userId: string, grantId: string): Promise<boolean | null> {
    const user = await this.deps.repo.findById(userId);
    if (user === null) {
      return null;
    }
    const grant = await this.deps.repo.getGrantById(grantId);
    if (grant !== null && grant.userId === userId && grant.source === "derived") {
      throw new DerivedGrantImmutableError();
    }
    const removed = await this.deps.repo.removeGrant(userId, grantId);
    if (removed) {
      await this.deps.sessions.invalidateAllForUser(userId);
    }
    return removed;
  }

  /**
   * One-time platform bootstrap (operator CLI): creates the first admin in
   * ACTIVE status with a college-wide admin grant. Refuses when any admin
   * exists — after bootstrap, user management goes through the API.
   */
  async bootstrapAdmin(input: {
    username: string;
    displayName: string;
    password: string;
    collegeId: string;
  }): Promise<{ userId: string }> {
    const admins = await this.deps.repo.countAdmins();
    if (admins > 0) {
      throw new Error("bootstrap refused: an admin account already exists");
    }
    const passwordHash = await this.deps.hasher.hash(input.password);
    const record = await this.deps.repo.create({
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      status: "active",
      collegeId: input.collegeId,
      roles: ["admin"],
      createdBy: null,
    });
    await this.deps.repo.addGrant(record.id, {
      role: "admin",
      org: { collegeId: input.collegeId },
      grantedBy: "bootstrap",
    });
    await this.deps.audit.record({
      module: "identity",
      action: "identity.bootstrap-admin",
      actorType: "system",
      actorId: null,
      resourceType: "user",
      resourceId: record.id,
      requestId: null,
      details: { username: input.username, collegeId: input.collegeId },
    });
    return { userId: record.id };
  }

  static grantView = grantView;
}
