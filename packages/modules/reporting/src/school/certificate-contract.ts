import { z } from "zod";
import { documentStyleSchema } from "./document-format";

export const CERTIFICATE_SNAPSHOT_VERSION = "school-certificate.snapshot.v1" as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "valid calendar date required");

// People and audit identifiers are opaque strings (for example stu_<UUID>),
// not bare UUIDs. Keep their length bound aligned with the platform ID contract.
const opaqueId = z.string().min(1).max(64).refine(
  (value) => value === value.trim() && !/[\x00-\x1f\x7f]/.test(value),
  "valid opaque identifier required",
);

const common = z.object({
  snapshotVersion: z.literal(CERTIFICATE_SNAPSHOT_VERSION),
  schoolId: opaqueId,
  studentId: opaqueId,
  enrollmentId: opaqueId,
  number: z.string().trim().min(3).max(64),
  academicYear: z.string().trim().min(4).max(24),
  issuedAt: z.string().datetime({ offset: true }),
  issuedBy: z.enum(["admin", "principal"]),
  correctionOfNumber: z.string().trim().min(3).max(64).nullable(),
  student: z.object({
    fullName: z.string().trim().min(2).max(120),
    admissionNo: z.string().trim().min(1).max(64),
  }).strict(),
  enrollment: z.object({
    className: z.string().trim().min(1).max(80),
    sectionName: z.string().trim().min(1).max(40),
    startsOn: dateOnly,
    endsOn: dateOnly.nullable(),
  }).strict(),
  /** Frozen school presentation; reprinting never reads today's format. */
  style: documentStyleSchema,
}).strict();

const transferSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recorded_transfer"), progressionAuditId: opaqueId }).strict(),
  z.object({ kind: z.literal("manual_exception"), approvalAuditId: opaqueId,
    exceptionReason: z.string().trim().min(3).max(300) }).strict(),
]);

export const certificateSnapshotSchema = z.discriminatedUnion("kind", [
  common.extend({ kind: z.literal("bonafide") }),
  common.extend({ kind: z.literal("transfer"), leavingOn: dateOnly,
    leavingReason: z.string().trim().min(3).max(300), source: transferSource }),
]).superRefine((value, context) => {
  if (value.enrollment.endsOn !== null && value.enrollment.endsOn < value.enrollment.startsOn) {
    context.addIssue({ code: "custom", path: ["enrollment", "endsOn"], message: "enrollment ends before it begins" });
  }
  if (value.correctionOfNumber === value.number) {
    context.addIssue({ code: "custom", path: ["correctionOfNumber"], message: "a correction needs a new number" });
  }
  if (value.kind === "transfer") {
    if (value.leavingOn < value.enrollment.startsOn) {
      context.addIssue({ code: "custom", path: ["leavingOn"], message: "leaving date precedes enrollment" });
    }
    if (value.source.kind === "recorded_transfer" && value.enrollment.endsOn !== value.leavingOn) {
      context.addIssue({ code: "custom", path: ["enrollment", "endsOn"], message: "recorded exit and leaving date differ" });
    }
  }
});

export type CertificateSnapshot = z.infer<typeof certificateSnapshotSchema>;

const SNAPSHOT_PARSERS: Readonly<Record<string, typeof certificateSnapshotSchema>> = {
  [CERTIFICATE_SNAPSHOT_VERSION]: certificateSnapshotSchema,
};

/** Unknown versions fail closed; old versions remain renderable when a new one is added. */
export function parseStoredCertificateSnapshot(payload: unknown): CertificateSnapshot | null {
  const version = (payload as { snapshotVersion?: unknown } | null)?.snapshotVersion;
  if (typeof version !== "string") return null;
  const parser = SNAPSHOT_PARSERS[version];
  if (parser === undefined) return null;
  const parsed = parser.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
