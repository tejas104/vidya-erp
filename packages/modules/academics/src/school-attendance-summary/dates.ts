/**
 * ISO calendar-date helpers for the attendance summary engine.
 *
 * Every date in this module is a plain "YYYY-MM-DD" string. All arithmetic
 * and comparison happens in UTC-anchored terms so the host machine's local
 * timezone can never change a result: `new Date("2026-06-15").getDay()` is
 * timezone-dependent (it reads the LOCAL day for a UTC-midnight instant,
 * which can roll to the wrong calendar date near midnight in negative UTC
 * offsets). This module never calls `getDay`/`getDate`/`new Date(string)`
 * for anything that affects output — dates are parsed into {y,m,d} integers
 * by hand and all Date use goes through `Date.UTC` plus the UTC getters.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

function parseParts(value: string): DateParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function format(parts: DateParts): string {
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True iff `value` is "YYYY-MM-DD" AND names a real calendar date (rejects
 * 2026-02-30, 2026-13-01, etc. — Date.UTC silently rolls those over, so the
 * round-trip through UTC getters is what actually catches them). */
export function isValidIsoDate(value: string): boolean {
  const parts = parseParts(value);
  if (!parts) return false;
  const ms = Date.UTC(parts.year, parts.month - 1, parts.day);
  const roundTrip = new Date(ms);
  return (
    roundTrip.getUTCFullYear() === parts.year &&
    roundTrip.getUTCMonth() === parts.month - 1 &&
    roundTrip.getUTCDate() === parts.day
  );
}

/** Lexicographic order on "YYYY-MM-DD" strings is chronological order
 * (fixed-width, zero-padded), so no Date object is needed to compare. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of every calendar date from `from` to `to`. Callers must
 * validate both dates and `from <= to` first — this trusts its input. */
export function enumerateIsoDates(from: string, to: string): string[] {
  const start = parseParts(from)!;
  const end = parseParts(to)!;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  const days: string[] = [];
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
    const cursor = new Date(ms);
    days.push(format({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() }));
  }
  return days;
}
