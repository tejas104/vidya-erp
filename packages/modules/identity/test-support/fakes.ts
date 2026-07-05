/**
 * TEST DOUBLES for the identity module's unit tests (and the integration
 * suite until the HUMAN-OWNED core lands). Deliberately insecure by
 * construction — the "hash" embeds the password, tokens are sequential —
 * so nobody can mistake them for the production core. They exist to
 * exercise Fable-owned plumbing; the real implementations are accepted
 * only via the conformance suites in src/core/conformance.
 */

import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  AuditLogger,
  Role,
} from "@vidya/platform";
import type {
  IssuedSession,
  PasswordHasher,
  SessionData,
  SessionManager,
  SessionRecord,
} from "../src/core/contracts";
import type {
  GrantSource,
  NewGrant,
  StoredGrant,
  UserRecord,
  UsersRepo,
  UserStatus,
} from "../src/repo/users-repo";
import { RoleNotHeldError, UsernameTakenError } from "../src/repo/users-repo";

/** Seed shape: provenance fields optional, filled with manual defaults. */
export type SeedGrant = Omit<StoredGrant, "userId" | "source" | "sourceRef"> & {
  source?: GrantSource;
  sourceRef?: string | null;
};
import type { ResetTokensRepo } from "../src/repo/reset-tokens-repo";
import type { ThrottleStore } from "../src/service/throttle";

// ---------------------------------------------------------------------------

export class FakePasswordHasher implements PasswordHasher {
  readonly dummyHash = "fake-hash::__nobody__::0000000000000000";
  rehashNeeded = false;
  verifyCalls: string[] = [];

  async hash(password: string): Promise<string> {
    return `fake-hash::${password}::${randomUUID()}`;
  }

  async verify(hash: string, password: string): Promise<boolean> {
    this.verifyCalls.push(hash);
    const parts = hash.split("::");
    return parts[0] === "fake-hash" && parts[1] === password && parts[1] !== "__nobody__";
  }

  needsRehash(): boolean {
    return this.rehashNeeded;
  }
}

// ---------------------------------------------------------------------------

export class FakeSessionManager implements SessionManager {
  private readonly byToken = new Map<string, SessionRecord>();
  private counter = 0;
  readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async issue(data: SessionData): Promise<IssuedSession> {
    this.counter += 1;
    const sessionId = `sess-${this.counter}`;
    const token = `token-${this.counter}-${randomUUID()}`;
    const now = new Date();
    const record: SessionRecord = {
      ...data,
      sessionId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
    };
    this.byToken.set(token, record);
    return { token, sessionId, expiresAt: record.expiresAt };
  }

  async resolve(token: string): Promise<SessionRecord | null> {
    const record = this.byToken.get(token);
    if (record === undefined || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return record;
  }

  async invalidate(sessionId: string): Promise<void> {
    for (const [token, record] of this.byToken) {
      if (record.sessionId === sessionId) {
        this.byToken.delete(token);
      }
    }
  }

  async invalidateAllForUser(userId: string): Promise<number> {
    let count = 0;
    for (const [token, record] of this.byToken) {
      if (record.userId === userId) {
        this.byToken.delete(token);
        count += 1;
      }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------

export class RecordingAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  actions(): string[] {
    return this.events.map((event) => event.action);
  }
}

// ---------------------------------------------------------------------------

export class MemoryThrottleStore implements ThrottleStore {
  readonly values = new Map<string, number>();
  readonly expirations = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const value = this.values.get(key);
    return value === undefined ? null : String(value);
  }
  async incr(key: string): Promise<number> {
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
  async expire(key: string, seconds: number): Promise<void> {
    this.expirations.set(key, seconds);
  }
  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.values.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------

interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  collegeId: string;
  createdAt: Date;
  roles: Role[];
  grants: StoredGrant[];
}

export class FakeUsersRepo implements UsersRepo {
  readonly byId = new Map<string, StoredUser>();

  seed(user: {
    id?: string;
    username: string;
    displayName?: string;
    passwordHash: string;
    status?: UserStatus;
    collegeId?: string;
    roles?: Role[];
    grants?: SeedGrant[];
  }): StoredUser {
    const id = user.id ?? randomUUID();
    const stored: StoredUser = {
      id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      passwordHash: user.passwordHash,
      status: user.status ?? "active",
      collegeId: user.collegeId ?? "col-1",
      createdAt: new Date(),
      roles: user.roles ?? [],
      grants: (user.grants ?? []).map((grant) => ({
        ...grant,
        userId: id,
        source: grant.source ?? "manual",
        sourceRef: grant.sourceRef ?? null,
      })),
    };
    this.byId.set(stored.id, stored);
    return stored;
  }

  async create(user: Parameters<UsersRepo["create"]>[0]): Promise<UserRecord> {
    if (await this.findByUsername(user.username)) {
      throw new UsernameTakenError(user.username);
    }
    return this.seed({
      username: user.username,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      status: user.status,
      collegeId: user.collegeId,
      roles: [...user.roles],
    });
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    for (const user of this.byId.values()) {
      if (user.username.toLowerCase() === username.toLowerCase()) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByCollege(collegeId: string, limit: number, offset: number): Promise<UserRecord[]> {
    return [...this.byId.values()]
      .filter((user) => user.collegeId === collegeId)
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(offset, offset + limit);
  }

  async update(
    id: string,
    patch: { displayName?: string; status?: UserStatus },
  ): Promise<UserRecord | null> {
    const user = this.byId.get(id);
    if (user === undefined) {
      return null;
    }
    if (patch.displayName !== undefined) {
      user.displayName = patch.displayName;
    }
    if (patch.status !== undefined) {
      user.status = patch.status;
    }
    return user;
  }

  async updatePasswordHash(id: string, passwordHash: string, status: UserStatus): Promise<void> {
    const user = this.byId.get(id);
    if (user !== undefined) {
      user.passwordHash = passwordHash;
      user.status = status;
    }
  }

  async getRoles(userId: string): Promise<Role[]> {
    return [...(this.byId.get(userId)?.roles ?? [])].sort();
  }

  async setRoles(userId: string, roles: readonly Role[], _grantedBy: string): Promise<void> {
    const user = this.byId.get(userId);
    if (user !== undefined) {
      user.roles = [...roles];
      // Mirror the composite-FK cascade: grants of revoked roles disappear.
      user.grants = user.grants.filter((grant) => user.roles.includes(grant.role));
    }
  }

  async addRole(userId: string, role: Role, _grantedBy: string): Promise<void> {
    const user = this.byId.get(userId);
    if (user !== undefined && !user.roles.includes(role)) {
      user.roles.push(role);
    }
  }

  async getGrants(userId: string): Promise<StoredGrant[]> {
    return [...(this.byId.get(userId)?.grants ?? [])];
  }

  async getGrantById(grantId: string): Promise<StoredGrant | null> {
    for (const user of this.byId.values()) {
      const grant = user.grants.find((entry) => entry.id === grantId);
      if (grant !== undefined) {
        return grant;
      }
    }
    return null;
  }

  async findGrantBySourceRef(sourceRef: string): Promise<StoredGrant | null> {
    for (const user of this.byId.values()) {
      const grant = user.grants.find((entry) => entry.sourceRef === sourceRef);
      if (grant !== undefined) {
        return grant;
      }
    }
    return null;
  }

  async listGrantsBySourcePrefix(prefix: string): Promise<StoredGrant[]> {
    const results: StoredGrant[] = [];
    for (const user of this.byId.values()) {
      results.push(
        ...user.grants.filter((entry) => entry.sourceRef?.startsWith(prefix) ?? false),
      );
    }
    return results;
  }

  async listUnverifiedGrants(): Promise<StoredGrant[]> {
    const results: StoredGrant[] = [];
    for (const user of this.byId.values()) {
      results.push(...user.grants.filter((entry) => !entry.verified));
    }
    return results;
  }

  async markGrantVerified(grantId: string): Promise<void> {
    for (const user of this.byId.values()) {
      user.grants = user.grants.map((entry) =>
        entry.id === grantId ? { ...entry, verified: true } : entry,
      );
    }
  }

  async addGrant(userId: string, grant: NewGrant): Promise<StoredGrant> {
    const user = this.byId.get(userId);
    if (user === undefined || !user.roles.includes(grant.role)) {
      throw new RoleNotHeldError(grant.role);
    }
    const stored: StoredGrant = {
      id: randomUUID(),
      userId,
      role: grant.role,
      org: grant.org,
      ...(grant.subjectId !== undefined ? { subjectId: grant.subjectId } : {}),
      verified: grant.verified ?? false,
      source: grant.source ?? "manual",
      sourceRef: grant.sourceRef ?? null,
    };
    user.grants.push(stored);
    return stored;
  }

  async removeGrant(userId: string, grantId: string): Promise<boolean> {
    const user = this.byId.get(userId);
    if (user === undefined) {
      return false;
    }
    const before = user.grants.length;
    user.grants = user.grants.filter((grant) => grant.id !== grantId);
    return user.grants.length < before;
  }

  async countAdmins(): Promise<number> {
    return [...this.byId.values()].filter((user) => user.roles.includes("admin")).length;
  }
}

// ---------------------------------------------------------------------------

export class FakeResetTokensRepo implements ResetTokensRepo {
  readonly rows: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdBy: string;
  }[] = [];

  async create(entry: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
  }): Promise<void> {
    this.rows.push({ id: randomUUID(), usedAt: null, ...entry });
  }

  async findValidByHash(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null> {
    const row = this.rows.find(
      (entry) =>
        entry.tokenHash === tokenHash && entry.usedAt === null && entry.expiresAt > now,
    );
    return row === undefined ? null : { id: row.id, userId: row.userId };
  }

  async markUsed(id: string, now: Date): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row !== undefined) {
      row.usedAt = now;
    }
  }

  async deleteStale(now: Date): Promise<number> {
    const before = this.rows.length;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (row !== undefined && (row.expiresAt < now || row.usedAt !== null)) {
        this.rows.splice(index, 1);
      }
    }
    return before - this.rows.length;
  }
}
