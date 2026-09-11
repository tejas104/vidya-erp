import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { sysClockWatermark } from "../db/schema";

/**
 * DECISION 2 of the licence design spec — the clock.
 *
 * On-prem means the customer owns the clock. Setting it back rewinds licence
 * expiry and no signature scheme can prevent that. So this does not try to
 * prevent it: it makes regression DETECTABLE. A monotonic high-water mark
 * records the latest date the installation has ever observed; if the wall
 * clock is ever earlier than that mark by more than a day, the boot path
 * audits the regression and evaluates the licence at the mark instead.
 *
 * It never blocks anyone, by design. A legitimate NTP correction or a
 * timezone change must not be able to take a college's information system
 * down, which is what the one-day tolerance is for. And no phone-home: the
 * product's selling point is that it runs air-gapped.
 */

/** Wall-clock regression beyond this many days is treated as a rollback. */
export const CLOCK_ROLLBACK_TOLERANCE_DAYS = 1;

export interface ClockDecision {
  /** The date the licence should be evaluated at, `YYYY-MM-DD`. */
  readonly effectiveOn: string;
  /** Whole days the wall clock sits behind the mark, or null when in tolerance. */
  readonly rolledBackDays: number | null;
  /** New high-water value to persist, or null to leave the mark where it is. */
  readonly advanceTo: string | null;
}

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` in UTC — day granularity keeps timezone drift out of this. */
export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / MS_PER_DAY;
}

/**
 * Pure decision, separated from storage so every branch is unit-testable
 * without a database.
 */
export function evaluateClock(mark: string | null, now: Date): ClockDecision {
  const today = isoDay(now);
  if (mark === null) {
    return { effectiveOn: today, rolledBackDays: null, advanceTo: today };
  }
  const behind = dayNumber(mark) - dayNumber(today);
  if (behind > CLOCK_ROLLBACK_TOLERANCE_DAYS) {
    // Rolled back. Hold the mark where it is — advancing it to a wall clock
    // we just decided not to trust would launder the regression away.
    return { effectiveOn: mark, rolledBackDays: behind, advanceTo: null };
  }
  if (behind < 0) {
    return { effectiveOn: today, rolledBackDays: null, advanceTo: today };
  }
  // Within tolerance: use the wall clock, but never move the mark backwards.
  return { effectiveOn: today, rolledBackDays: null, advanceTo: null };
}

export interface ClockWatermark {
  /** Reads the mark, applies the decision, and persists any advance. */
  observe(now: Date): Promise<ClockDecision>;
}

export function createClockWatermark(db: Db): ClockWatermark {
  return {
    async observe(now) {
      const rows = await db.select().from(sysClockWatermark).limit(1);
      const decision = evaluateClock(rows[0]?.observedOn ?? null, now);
      if (decision.advanceTo !== null) {
        await db
          .insert(sysClockWatermark)
          .values({ id: true, observedOn: decision.advanceTo })
          .onConflictDoUpdate({
            target: sysClockWatermark.id,
            set: { observedOn: decision.advanceTo, updatedAt: sql`now()` },
          });
      }
      return decision;
    },
  };
}
