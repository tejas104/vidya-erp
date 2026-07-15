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
  | "doc";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}
