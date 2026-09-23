import { describeGuardianAccessConformance, describeInvitationConformance } from "./cases";
import { createGuardianAccessAdapter, createInvitationAdapter } from "./adapter";

/**
 * Runs the S03 specification against the real implementation.
 *
 * `cases.test.ts` validates the specification's own shape and coverage; this
 * file proves the adapter ENFORCES it. Same split as the scope-checker's
 * conformance suite, which is only ever invoked from an implementation's own
 * test file (ADR-0012's pattern).
 */
describeGuardianAccessConformance("relationship adapter", createGuardianAccessAdapter);
describeInvitationConformance("recorded-state invitation adapter", createInvitationAdapter);
