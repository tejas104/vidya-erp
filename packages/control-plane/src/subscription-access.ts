import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "valid calendar date required");

/** Recorded business state and calculated access are kept distinct. */
const recordSchema = z.object({
  state: z.enum(["trial", "active", "past_due", "grace", "restricted", "suspended", "cancelled"]),
  paidThrough: dateOnly,
  graceDays: z.literal(30),
}).strict();

export type SubscriptionRecord = z.infer<typeof recordSchema>;
export type SubscriptionAccess = {
  mode: "full" | "read_only";
  reason: "within_term" | "grace" | "grace_ended" | "suspended" | "cancelled" | "invalid_record";
  daysOverdue: number;
  downloadsAllowed: true;
  fullExportAllowed: true;
};

const DAY = 86_400_000;

/**
 * Pure UTC-date policy for the hosted service. This does not itself gate an
 * ERP route; publication, tenant-side verification and outage behavior are
 * separate, reviewed steps. Even restricted states retain record retrieval.
 */
export function subscriptionAccess(input: unknown, now: Date): SubscriptionAccess {
  const record = recordSchema.safeParse(input);
  if (!record.success || !Number.isFinite(now.getTime())) {
    return { mode: "read_only", reason: "invalid_record", daysOverdue: 0,
      downloadsAllowed: true, fullExportAllowed: true };
  }
  const { state, paidThrough, graceDays } = record.data;
  const boundary = Date.parse(`${paidThrough}T00:00:00.000Z`) + DAY;
  const daysOverdue = Math.max(0, Math.floor((now.getTime() - boundary) / DAY) + 1);
  if (state === "suspended") return { mode: "read_only", reason: "suspended", daysOverdue, downloadsAllowed: true, fullExportAllowed: true };
  if (state === "cancelled") return { mode: "read_only", reason: "cancelled", daysOverdue, downloadsAllowed: true, fullExportAllowed: true };
  if (state === "restricted") return { mode: "read_only", reason: "grace_ended", daysOverdue, downloadsAllowed: true, fullExportAllowed: true };
  if (now.getTime() < boundary) return { mode: "full", reason: "within_term", daysOverdue: 0, downloadsAllowed: true, fullExportAllowed: true };
  if (daysOverdue <= graceDays) return { mode: "full", reason: "grace", daysOverdue, downloadsAllowed: true, fullExportAllowed: true };
  return { mode: "read_only", reason: "grace_ended", daysOverdue, downloadsAllowed: true, fullExportAllowed: true };
}
