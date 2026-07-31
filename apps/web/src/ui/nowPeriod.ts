import type { TtPeriod, TtToday } from "@/ui/api";

export type NowEntry = TtToday["entries"][number];

export type NowSlot = {
  entry: NowEntry;
  period: TtPeriod | null;
  startMin: number | null;
  endMin: number | null;
};

export type NowState =
  | { kind: "no-timetable" }
  | { kind: "off-day" }
  | { kind: "no-classes" }
  | { kind: "day-done" }
  | { kind: "active"; ongoing: boolean; featured: NowSlot; remaining: NowSlot[] };

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Derives the teacher's "Now" state from today's timetable: the period
 * spanning the clock right now (else the next one still to start), and
 * what's left after it.
 *
 * Boundary rule: a period is "ongoing" from its start minute (inclusive) up
 * to — but not including — its end minute. That inclusive start is what
 * makes back-to-back periods hand off cleanly: at the exact minute period B
 * begins, it is already "ongoing" (start <= now), so there is never a dead
 * minute where neither the ending period nor the starting one is featured.
 */
export function deriveNow(today: TtToday, nowMinutes: number): NowState {
  if (today.periods.length === 0) return { kind: "no-timetable" };
  if (today.dayOfWeek === 0) return { kind: "off-day" };
  if (today.entries.length === 0) return { kind: "no-classes" };

  const byPeriodNo = new Map(today.periods.map((p) => [p.periodNo, p]));
  const slots: NowSlot[] = today.entries
    .map((entry) => {
      const period = byPeriodNo.get(entry.periodNo) ?? null;
      return {
        entry,
        period,
        startMin: period ? toMin(period.starts) : null,
        endMin: period ? toMin(period.ends) : null,
      };
    })
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));

  const ongoing = slots.find(
    (s) => s.startMin !== null && s.endMin !== null && s.startMin <= nowMinutes && nowMinutes < s.endMin,
  );
  const upcoming = slots
    .filter((s) => s.startMin !== null && s.startMin > nowMinutes)
    .sort((a, b) => a.startMin! - b.startMin!)[0];
  const featured = ongoing ?? upcoming;

  // Every period that started has also ended (day-done), OR there simply is
  // no ongoing/upcoming match left — either way, nothing is left to feature.
  if (!featured) return { kind: "day-done" };

  // Today's remaining periods: everything but the featured one that hasn't
  // ended yet. A slot with no matching period definition (endMin === null)
  // can't be proven "done", so it stays visible rather than being hidden.
  const remaining = slots.filter((s) => s !== featured && (s.endMin === null || s.endMin > nowMinutes));

  return { kind: "active", ongoing: ongoing !== undefined, featured, remaining };
}
