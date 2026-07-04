/**
 * TEST-ONLY entrypoint (`@vidya/module-identity/conformance`) — the
 * acceptance harness for the human-owned security core (ADR-0012).
 *
 * This subpath exists so the root-level integration suite can invoke the
 * conformance suites against the real implementations without a deep
 * import (Constitution rule 3). It imports vitest and must NEVER be
 * re-exported from the module's production API (src/index.ts).
 */

export { describePasswordHasherConformance } from "./password-hasher";
export {
  describeSessionManagerConformance,
  type SessionManagerConformanceHarness,
} from "./session-manager";
export { describeScopeCheckerConformance } from "./scope-checker";

// The real SessionManager implementation is consumed in production only
// through createIdentityCore (the ./core gate); the integration harness is
// its one external caller, so it is exposed here rather than on the
// production API.
export { createSessionManager, type SessionManagerOptions } from "../session-manager";
