import type { OrgPath } from "@vidya/platform";
import type { OrgRepo } from "../repo/org-repo";
import type { PeopleRepo, StudentStatus } from "../repo/people-repo";
import { GuardianHistoryPolicyConflictError, PROGRESSION_AUDIT, ProgressionReversalConflictError, type AppliedPupil, type ProgressionApplyInput, type ProgressionRepo, type RecordedOutcome } from "../repo/progression-repo";

export type ProgressionChoice = "promote" | "detain" | "transfer_out" | "graduate";

/** ADR-0027 Decision 9 default for schools with no customized policy. */
export const HISTORICAL_ACCESS_DAYS = 90;
const DAY_MS = 86_400_000;

export interface ProgressionPlan {
  readonly workflow?: "single_exit";
  readonly sectionId: string;
  readonly academicYear: string;
  /** Last day on this section's roll; for an exit, the leaving date. */
  readonly endsOn: string;
  readonly targetAcademicYear?: string;
  readonly startsOn?: string;
  readonly promoteToSectionId?: string;
  readonly detainInSectionId?: string;
  readonly pupils: readonly { readonly studentId: string; readonly enrollmentId: string; readonly outcome: ProgressionChoice; readonly reason?: string }[];
  /** The policy version displayed in the last preview; required to apply an exit. */
  readonly expectedHistoryPolicyVersion?: number;
}

export interface PreviewPupil {
  readonly studentId: string;
  readonly admissionNo: string;
  readonly fullName: string;
  readonly enrollmentId: string;
  readonly outcome: ProgressionChoice;
  readonly statusBefore: string;
  readonly statusAfter: StudentStatus;
  readonly targetSectionId: string | null;
  readonly reason: string | null;
  /** Guardian relationships whose live access ends at this exit. */
  readonly familyLinks: number;
  readonly problems: string[];
}

export interface ProgressionPreview {
  readonly sectionId: string;
  readonly academicYear: string;
  readonly endsOn: string;
  readonly targetAcademicYear: string | null;
  readonly startsOn: string | null;
  readonly familyAccess: { readonly liveUntil: string; readonly historicalAccessUntil: string; readonly days: number; readonly policyVersion: number } | null;
  readonly pupils: PreviewPupil[];
  /** On the roll but not in this plan: left exactly as they are. */
  readonly undecided: { readonly studentId: string; readonly admissionNo: string; readonly fullName: string }[];
  readonly problems: string[];
  readonly ready: boolean;
}

export class ProgressionBlockedError extends Error {
  constructor(readonly preview: ProgressionPreview) {
    super("Resolve the problems in the preview before applying.");
    this.name = "ProgressionBlockedError";
  }
}

const RECORDED: Record<ProgressionChoice, RecordedOutcome> = {
  promote: "promoted", detain: "detained", transfer_out: "transferred_out", graduate: "graduated",
};
const STATUS_AFTER: Record<ProgressionChoice, StudentStatus> = {
  promote: "active", detain: "active", transfer_out: "transferred", graduate: "alumni",
};

/** The school's calendar day, as the attendance review reads it (school-academics). */
function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Live family access ends after the leaving day; read-only access uses the school's policy. */
export function familyAccessWindow(endsOn: string, days = HISTORICAL_ACCESS_DAYS): { liveUntil: Date; historicalAccessUntil: Date } {
  const liveUntil = new Date(Date.parse(`${endsOn}T00:00:00Z`) + DAY_MS);
  return { liveUntil, historicalAccessUntil: new Date(liveUntil.getTime() + days * DAY_MS) };
}

export interface ProgressionServiceDeps {
  readonly people: PeopleRepo;
  readonly org: OrgRepo;
  readonly repo: ProgressionRepo;
  readonly relationships: (studentId: string) => Promise<readonly { status: string; validUntil: Date | null }[]>;
  readonly today?: () => string;
  readonly readAudit?: (resourceType: string, resourceId: string, limit: number, beforeId?: number) => Promise<readonly { id: number; action: string; details: unknown }[]>;
}

/**
 * Year-end changes or today's one-pupil exit for one section (N6). Preview and
 * apply run the same checks; apply writes only a plan whose preview is clean,
 * and the repo's conditional updates catch anything that moved in between.
 */
export class ProgressionService {
  constructor(private readonly deps: ProgressionServiceDeps) {}

  getHistoryPolicy(collegeId: string) { return this.deps.repo.getHistoryPolicy(collegeId); }

  updateHistoryPolicy(input: Parameters<ProgressionRepo["updateHistoryPolicy"]>[0]) {
    return this.deps.repo.updateHistoryPolicy(input);
  }

  async reverse(input: {
    studentId: string; sourceEnrollmentId: string; reason: string; org: OrgPath;
    attribution: ProgressionApplyInput["attribution"];
  }) {
    if (!this.deps.readAudit) throw new Error("Progression reversal requires audit history.");
    let beforeId: number | undefined;
    let evidence: {
      outcome: RecordedOutcome; endsOn: string; newEnrollmentId: string | null;
      sectionId: string; academicYear: string;
      next: { sectionId: string; academicYear: string; startsOn: string } | null;
      before: { status: StudentStatus }; after: { status: StudentStatus };
      familyAccess: readonly {
        relationshipId: string;
        before: { validUntil: string | null; historicalAccessUntil: string | null };
        after: { validUntil: string; historicalAccessUntil: string };
      }[];
    } | null = null;
    for (;;) {
      const page = await this.deps.readAudit("student", input.studentId, 1000, beforeId);
      const found = page.find((event) => event.action === PROGRESSION_AUDIT.pupil.action &&
        typeof event.details === "object" && event.details !== null &&
        (event.details as { closedEnrollmentId?: unknown }).closedEnrollmentId === input.sourceEnrollmentId);
      if (found) {
        const detail = found.details as Record<string, unknown>;
        if (!["promoted", "detained", "transferred_out", "graduated"].includes(String(detail.outcome)) ||
            typeof detail.endsOn !== "string" || typeof detail.newEnrollmentId !== "string" && detail.newEnrollmentId !== null ||
            typeof detail.sectionId !== "string" || typeof detail.academicYear !== "string" ||
            typeof detail.before !== "object" || detail.before === null ||
            typeof detail.after !== "object" || detail.after === null ||
            !Array.isArray(detail.familyAccess)) {
          throw new ProgressionReversalConflictError("The original progression audit is incomplete.");
        }
        const before = detail.before as { status?: unknown };
        const after = detail.after as { status?: unknown };
        const statuses: StudentStatus[] = ["active", "inactive", "backlog", "year_back", "transferred", "dropped", "alumni"];
        if (!statuses.includes(before.status as StudentStatus) || !statuses.includes(after.status as StudentStatus)) {
          throw new ProgressionReversalConflictError("The original status audit is incomplete.");
        }
        const next = detail.next;
        if ((detail.newEnrollmentId === null ? next !== null :
          typeof next !== "object" || next === null ||
          typeof (next as Record<string, unknown>).sectionId !== "string" ||
          typeof (next as Record<string, unknown>).academicYear !== "string" ||
          typeof (next as Record<string, unknown>).startsOn !== "string") ||
          (["promoted", "detained"].includes(String(detail.outcome)) !== (detail.newEnrollmentId !== null))) {
          throw new ProgressionReversalConflictError("The original next-year placement audit is incomplete.");
        }
        const familyAccess = detail.familyAccess as {
          relationshipId: string; before: { validUntil: string | null; historicalAccessUntil: string | null };
          after: { validUntil: string; historicalAccessUntil: string };
        }[];
        if (familyAccess.some((link) => typeof link.relationshipId !== "string" ||
            !link.before || !link.after || typeof link.after.validUntil !== "string" ||
            typeof link.after.historicalAccessUntil !== "string")) {
          throw new ProgressionReversalConflictError("The family access audit is incomplete.");
        }
        evidence = {
          outcome: detail.outcome as RecordedOutcome, endsOn: detail.endsOn,
          newEnrollmentId: detail.newEnrollmentId as string | null,
          sectionId: detail.sectionId as string, academicYear: detail.academicYear as string,
          next: next as { sectionId: string; academicYear: string; startsOn: string } | null,
          before: { status: before.status as StudentStatus }, after: { status: after.status as StudentStatus },
          familyAccess,
        };
        break;
      }
      if (page.length < 1000) break;
      beforeId = page[page.length - 1]!.id;
    }
    if (!evidence) throw new ProgressionReversalConflictError("No applied outcome was recorded for this enrollment.");
    return this.deps.repo.reverse({
      studentId: input.studentId, sourceEnrollmentId: input.sourceEnrollmentId,
      nextEnrollmentId: evidence.newEnrollmentId, outcome: evidence.outcome, endsOn: evidence.endsOn,
      sectionId: evidence.sectionId, academicYear: evidence.academicYear, next: evidence.next,
      today: this.deps.today?.() ?? schoolToday(),
      statusBefore: evidence.before.status, statusAfter: evidence.after.status,
      familyAccess: evidence.familyAccess, reason: input.reason, org: input.org, attribution: input.attribution,
    });
  }

  async preview(plan: ProgressionPlan): Promise<ProgressionPreview> {
    const today = this.deps.today?.() ?? schoolToday();
    const problems: string[] = [];
    const continuing = plan.pupils.some((pupil) => pupil.outcome === "promote" || pupil.outcome === "detain");
    const exits = plan.pupils.some((pupil) => pupil.outcome === "transfer_out" || pupil.outcome === "graduate");

    if (plan.endsOn > today) problems.push("The closing date cannot be later than today.");
    if (plan.workflow === "single_exit") {
      if (plan.pupils.length !== 1 || !exits || continuing) problems.push("Choose one pupil to transfer or graduate.");
      if (plan.endsOn !== today) problems.push("A one-pupil exit must be recorded for today.");
    }
    if (continuing) {
      if (!plan.targetAcademicYear || plan.targetAcademicYear <= plan.academicYear) problems.push("Choose a next academic year after the one being closed.");
      if (!plan.startsOn || plan.startsOn <= plan.endsOn) problems.push("The new year must start after the closing date.");
    }
    const source = await this.deps.org.getSection(plan.sectionId);
    const sourcePath = await this.deps.org.pathForSection(plan.sectionId);
    const policy = sourcePath ? await this.deps.repo.getHistoryPolicy(sourcePath.collegeId) : null;
    if (exits && policy === null) problems.push("The school's guardian history setting could not be loaded.");
    const window = familyAccessWindow(plan.endsOn, policy?.days ?? HISTORICAL_ACCESS_DAYS);
    const sourceClassId = source?.classId ?? null;
    const target = async (sectionId: string | undefined, needed: boolean, sameClass: boolean, label: string) => {
      if (!needed) return;
      const section = sectionId === undefined ? null : await this.deps.org.getSection(sectionId);
      if (section === null) problems.push(`Choose the section to ${label}.`);
      else if ((section.classId === sourceClassId) !== sameClass) {
        problems.push(sameClass ? "Detained pupils repeat a section of the same standard." : "Promoted pupils move to a section of a different standard.");
      }
    };
    await target(plan.promoteToSectionId, plan.pupils.some((pupil) => pupil.outcome === "promote"), false, "promote into");
    await target(plan.detainInSectionId, plan.pupils.some((pupil) => pupil.outcome === "detain"), true, "repeat in");

    const roll = (await this.deps.people.roster(plan.sectionId)).filter((entry) => entry.enrollment.academicYear === plan.academicYear);
    const byStudent = new Map(roll.map((entry) => [entry.student.id, entry]));
    const seen = new Set<string>();
    const pupils: PreviewPupil[] = [];
    for (const choice of plan.pupils) {
      const own: string[] = [];
      if (seen.has(choice.studentId)) problems.push("A pupil appears more than once in the plan.");
      seen.add(choice.studentId);
      const entry = byStudent.get(choice.studentId);
      if (entry === undefined || entry.enrollment.id !== choice.enrollmentId) {
        own.push(`Not on this section's ${plan.academicYear} roll any more. Reload the roster.`);
      } else if (entry.enrollment.startsOn !== null && plan.endsOn < entry.enrollment.startsOn) {
        own.push(`Joined this section on ${entry.enrollment.startsOn}, after the closing date.`);
      }
      const reason = choice.reason?.trim() || null;
      if ((choice.outcome === "detain" || choice.outcome === "transfer_out" || choice.outcome === "graduate") && reason === null) {
        own.push(choice.outcome === "detain" ? "Record why the pupil is detained." : "Record the reason for leaving.");
      }
      const next = choice.outcome === "promote" ? plan.promoteToSectionId : choice.outcome === "detain" ? plan.detainInSectionId : undefined;
      if (next !== undefined && plan.targetAcademicYear && await this.deps.people.activeEnrollment(choice.studentId, plan.targetAcademicYear) !== null) {
        own.push(`Already enrolled for ${plan.targetAcademicYear}.`);
      }
      const leaving = choice.outcome === "transfer_out" || choice.outcome === "graduate";
      const familyLinks = leaving && entry !== undefined
        ? (await this.deps.relationships(choice.studentId)).filter((relationship) =>
          ["pending", "active", "restricted"].includes(relationship.status) &&
          (relationship.validUntil === null || relationship.validUntil > window.liveUntil)).length
        : 0;
      pupils.push({
        studentId: choice.studentId,
        admissionNo: entry?.student.admissionNo ?? "",
        fullName: entry?.student.fullName ?? "Unknown pupil",
        enrollmentId: choice.enrollmentId,
        outcome: choice.outcome,
        statusBefore: entry?.student.status ?? "",
        statusAfter: STATUS_AFTER[choice.outcome],
        targetSectionId: next ?? null,
        reason,
        familyLinks,
        problems: own,
      });
    }
    return {
      sectionId: plan.sectionId,
      academicYear: plan.academicYear,
      endsOn: plan.endsOn,
      targetAcademicYear: continuing ? plan.targetAcademicYear ?? null : null,
      startsOn: continuing ? plan.startsOn ?? null : null,
      familyAccess: exits && policy ? {
        liveUntil: window.liveUntil.toISOString(), historicalAccessUntil: window.historicalAccessUntil.toISOString(),
        days: policy.days, policyVersion: policy.version,
      } : null,
      pupils,
      undecided: roll.filter((entry) => !seen.has(entry.student.id))
        .map((entry) => ({ studentId: entry.student.id, admissionNo: entry.student.admissionNo, fullName: entry.student.fullName })),
      problems: [...new Set(problems)],
      ready: problems.length === 0 && pupils.every((pupil) => pupil.problems.length === 0),
    };
  }

  async apply(plan: ProgressionPlan, org: OrgPath, attribution: ProgressionApplyInput["attribution"]): Promise<{ preview: ProgressionPreview; runId: string; pupils: AppliedPupil[]; receipt: Awaited<ReturnType<ProgressionRepo["apply"]>>["receipt"] }> {
    const preview = await this.preview(plan);
    if (!preview.ready) throw new ProgressionBlockedError(preview);
    if (preview.familyAccess && preview.familyAccess.policyVersion !== plan.expectedHistoryPolicyVersion) {
      throw new GuardianHistoryPolicyConflictError();
    }
    const applied = await this.deps.repo.apply({
      workflow: plan.workflow ?? "year_end",
      source: { sectionId: plan.sectionId, academicYear: plan.academicYear, org },
      endsOn: plan.endsOn,
      familyAccess: familyAccessWindow(plan.endsOn, preview.familyAccess?.days ?? HISTORICAL_ACCESS_DAYS),
      guardianHistoryPolicyVersion: preview.familyAccess?.policyVersion ?? null,
      rows: preview.pupils.map((pupil) => ({
        studentId: pupil.studentId,
        enrollmentId: pupil.enrollmentId,
        outcome: RECORDED[pupil.outcome],
        reason: pupil.reason,
        statusAfter: pupil.statusAfter,
        next: pupil.targetSectionId === null ? null : { sectionId: pupil.targetSectionId, academicYear: preview.targetAcademicYear!, startsOn: preview.startsOn! },
      })),
      attribution,
    });
    return { preview, ...applied };
  }
}
