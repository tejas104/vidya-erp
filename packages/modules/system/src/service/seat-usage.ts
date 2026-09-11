import type { LicenseStatus } from "@vidya/platform";

/**
 * DECISION 3 of the licence design spec — seats: record and surface, never
 * enforce. The admin System page already shows actual-vs-licensed ("N of M
 * licensed students"); this is the other half of the ruling, the audit row
 * written ONCE PER BOOT when the count is over the licensed figure — not per
 * student created.
 *
 * Blocking admissions at seat N+1 is the single worst moment to be right
 * about anything, so nothing here returns a decision anyone can act on: it
 * reports a fact for the audit log and the renewal conversation.
 *
 * Pure, so the boundary cases are testable without a database.
 */
export interface SeatOverage {
  readonly students: number;
  readonly seats: number;
  readonly licenseId: string;
}

export function seatOverage(license: LicenseStatus, students: number): SeatOverage | null {
  // invalid/absent carry no claims — there is no licensed figure to exceed.
  if (license.kind === "invalid" || license.kind === "absent") {
    return null;
  }
  if (students <= license.claims.seats) {
    return null;
  }
  return { students, seats: license.claims.seats, licenseId: license.claims.id };
}
