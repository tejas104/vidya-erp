/**
 * CONTRACT — LDAP / Active Directory / SSO integration point (Vidya #2
 * scope: interface only; implementing a provider is explicitly out of
 * scope and arrives as its own reviewed component).
 *
 * Wiring: the composition root passes an implementation to
 * `createIdentityModule({ externalProvider })`; the AuthService then
 * delegates credential verification to it instead of the local
 * PasswordHasher. Constraints the contract guarantees to the login flow:
 *
 *  - the account must already exist locally (username mapping) — there is
 *    NO auto-provisioning; provisioning stays an audited admin action;
 *  - roles/scope-grants remain locally managed — an external directory
 *    authenticates, it never authorizes;
 *  - a `null` return is indistinguishable from a wrong local password to
 *    the caller (uniform failure surface).
 */
export interface ExternalIdentityProvider {
  /** Short identifier for logs/audit, e.g. "ldap", "oidc". */
  readonly name: string;
  /**
   * Verifies credentials (LDAP bind) or a signed assertion (SSO) and
   * returns the external subject plus the LOCAL username it maps to,
   * or null when verification fails.
   */
  authenticate(input: {
    readonly username: string;
    readonly password?: string;
    readonly assertion?: string;
  }): Promise<{ readonly externalSubject: string; readonly username: string } | null>;
}
