import { randomUUID } from "node:crypto";

/**
 * Org identifiers are opaque strings under the #2/#3 identifier contract
 * (≤64 chars). The type prefix is purely for operator ergonomics — nothing
 * may parse meaning out of an id.
 */
export type IdPrefix =
  | "col"
  | "dep"
  | "cls"
  | "sec"
  | "sub"
  | "stu"
  | "tch"
  | "enr"
  | "asg"
  | "imp"
  | "doc"
  | "sat"
  | "prg";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Derives an identity username from a person's college-unique code
 * (admission_no for students, staff_no for teachers) — #11 B4 credential
 * issuance (per-class sheet, per-staff action). Reusing the code that is
 * already guaranteed unique within a college keeps
 * this collision-free across reruns of the same import (identity's username
 * index is GLOBAL, not per-college, so a name-derived slug would collide on
 * re-import with identical row data — the code does not).
 */
export function usernameFromCode(code: string): string {
  const cleaned = code.trim().toLowerCase().replace(/[^a-z0-9._@-]/g, "");
  return cleaned.length >= 3 ? cleaned.slice(0, 64) : cleaned.padEnd(3, "0");
}
