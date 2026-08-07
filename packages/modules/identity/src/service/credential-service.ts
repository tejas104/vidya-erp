import { generateTemporaryPassword, type Role } from "@vidya/platform";
import type { AuthService } from "./auth-service";
import type { UsersService } from "./users-service";

export interface CredentialServiceDeps {
  readonly users: UsersService;
  readonly auth: AuthService;
}

/**
 * Issues a login for a person who doesn't have one yet (#11 B2: bulk import,
 * per-class/staff "issue login" actions).
 *
 * Why the account ends ACTIVE, not must_reset: users-service.createUser
 * always starts accounts in must_reset, and auth-service.login refuses
 * must_reset accounts outright ("reset-required") — so a must_reset account
 * cannot sign in at all, and a newly onboarded person must be able to log in
 * with the sheet they're handed (spec 2026-08-05-a11-onboarding-import D2,
 * e2e guard (b)). This is reached the same way an admin resets anyone else's
 * password: create the account, then run the SAME plaintext through
 * adminSetPassword, which re-hashes it, flips status to active, and
 * invalidates sessions. No repo method was added and core/ was not touched.
 *
 * Force-change-on-first-login is a recorded, owner-ratified gap (D2): the
 * identity module has no such flag, and adding one means changing the
 * human-owned login choreography in auth-service.login — out of scope here,
 * carved out as its own separately-approved assignment.
 *
 * The plaintext password is returned to the caller exactly once. It is
 * never persisted (only its hash, written by the two calls below), never
 * logged, and never audited — the same discipline adminSetPassword's own
 * doc comment states for its own value.
 */
export class CredentialService {
  constructor(private readonly deps: CredentialServiceDeps) {}

  async issueCredential(input: {
    personName: string;
    username: string;
    collegeId: string;
    roles: readonly Role[];
    createdBy: string;
  }): Promise<{ userId: string; username: string; temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const created = await this.deps.users.createUser({
      username: input.username,
      displayName: input.personName,
      collegeId: input.collegeId,
      temporaryPassword,
      roles: input.roles,
      createdBy: input.createdBy,
    });
    await this.deps.auth.adminSetPassword(created.id, temporaryPassword);
    return { userId: created.id, username: created.username, temporaryPassword };
  }
}
