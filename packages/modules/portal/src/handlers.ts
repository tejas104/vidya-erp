import type { Principal, RouteContext, RouteHandler, RouteResult } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { GuardianRecordCategory, PeopleDirectory, PeopleModuleService } from "@vidya/module-people";
import type { TimetableReadModel } from "@vidya/module-timetable";
import type { SchoolAcademicsReadModel } from "@vidya/module-school-academics";
import { schoolTermMarks } from "./school-marks";

export interface PortalHandlerDeps {
  readonly directory: PeopleDirectory;
  readonly academicsRead: AcademicsReadModel;
  readonly timetableRead: TimetableReadModel;
  /** ADR-0027: the people module's guardian access decision. */
  readonly guardianAccess: PeopleModuleService["guardianAccess"];
  readonly edition?: "school" | "college";
  readonly schoolAcademicsRead?: SchoolAcademicsReadModel;
}

/** Whose records a portal view shows: resolved server-side, never trusted
 *  from the request alone. */
type Subject = { readonly studentId: string; readonly collegeId: string };
type Resolver = (ctx: RouteContext) => Promise<Subject | RouteResult>;
const isResult = (value: Subject | RouteResult): value is RouteResult => "status" in value;

/** JS getDay() → Mon=1..Sat=6 (Sunday → 0 = no periods today). */
function collegeDayOfWeek(date = new Date()): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 0 : jsDay;
}

function notLinked() {
  return { status: 404, body: { message: "this sign-in is not linked to a student record" } };
}

/**
 * SELF-SCOPE, BY CONSTRUCTION: every handler resolves the caller's student
 * through the identity link and never reads a studentId from the request —
 * the records fetched are the student's own, so no per-record scope check
 * is needed (the link is the authority; see the W1 program spec).
 */
export function createPortalHandlers(deps: PortalHandlerDeps): Record<string, RouteHandler> {
  async function linkedStudent(principal: Principal) {
    return deps.directory.studentByIdentityUser(principal.id);
  }

  /** A student sees their own record: the identity link is the authority. */
  const self: Resolver = async (ctx) => {
    const student = await linkedStudent(ctx.principal as Principal);
    // Project to a Subject: the student record has its own `status` field,
    // which must never be mistaken for a RouteResult by isResult().
    return student === null ? notLinked() : { studentId: student.studentId, collegeId: student.collegeId };
  };

  /**
   * A guardian sees a child's record only when the guardian access adapter
   * grants this category for this child, decided fresh on every request.
   * Every refusal is the same 403, so the response never says whether the
   * pupil exists, is someone else's child, or is merely a withheld category.
   */
  const child =
    (category: GuardianRecordCategory): Resolver =>
    async (ctx) => {
      const { studentId } = ctx.request.params as { studentId: string };
      const { decision, student } = await deps.guardianAccess((ctx.principal as Principal).id, studentId, category);
      if (!decision.granted || student === null) {
        ctx.logger.warn({ reason: decision.reason }, "guardian access denied");
        return { status: 403, body: { message: "access denied" } };
      }
      return { studentId: student.studentId, collegeId: student.collegeId };
    };

  const me: RouteHandler = async (ctx) => {
    const student = await linkedStudent(ctx.principal as Principal);
    if (student === null) {
      return notLinked();
    }
    // Live enrollment (if any): resolve section + class names via the directory.
    const position = await deps.directory.studentPosition(student.studentId);
    let enrollment = null;
    if (position?.sectionId !== undefined && position.classId !== undefined) {
      const names = await deps.directory.namesFor([position.sectionId, position.classId]);
      const roster = await deps.directory.sectionRoster(position.sectionId);
      const own = roster.find((entry) => entry.studentId === student.studentId);
      enrollment = {
        sectionId: position.sectionId,
        sectionName: names.get(position.sectionId) ?? position.sectionId,
        className: names.get(position.classId) ?? position.classId,
        academicYear: own?.academicYear ?? "",
      };
    }
    return {
      status: 200,
      body: {
        student: {
          id: student.studentId,
          admissionNo: student.admissionNo,
          fullName: student.fullName,
          status: student.status,
        },
        enrollment,
      },
    };
  };

  const attendance = (resolve: Resolver): RouteHandler => async (ctx) => {
    const student = await resolve(ctx);
    if (isResult(student)) return student;
    const query = ctx.request.query as { academicYear: string };
    const rows = await deps.academicsRead.studentAttendance(student.studentId, query.academicYear);
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    const byMonth = new Map<string, { attended: number; total: number }>();
    for (const row of rows) {
      counts[row.status] += 1;
      const month = row.heldOn.slice(0, 7);
      const slot = byMonth.get(month) ?? { attended: 0, total: 0 };
      slot.total += 1;
      if (row.status === "present" || row.status === "late") slot.attended += 1;
      byMonth.set(month, slot);
    }
    const total = rows.length;
    const attended = counts.present + counts.late;
    return {
      status: 200,
      body: {
        counts,
        pct: total === 0 ? null : Math.round((attended / total) * 1000) / 10,
        monthly: [...byMonth.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, slot]) => ({
            month,
            pct: Math.round((slot.attended / slot.total) * 1000) / 10,
          })),
        sessions: rows
          .slice()
          .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
          .slice(0, 30)
          .map((row) => ({ heldOn: row.heldOn, status: row.status })),
      },
    };
  };

  const marks = (resolve: Resolver): RouteHandler => async (ctx) => {
    if (deps.edition === "school") return { status: 404, body: { message: "college marks are unavailable in the school edition" } };
    const student = await resolve(ctx);
    if (isResult(student)) return student;
    const query = ctx.request.query as { academicYear: string };
    const rows = await deps.academicsRead.studentMarks(student.studentId, query.academicYear);
    const bySubject = new Map<
      string,
      { sum: number; n: number; marks: { assessmentName: string; kind: string; pct: number; heldOn: string | null }[] }
    >();
    for (const mark of rows.slice().sort((a, b) => (a.heldOn ?? a.recordedAt).localeCompare(b.heldOn ?? b.recordedAt))) {
      const slot = bySubject.get(mark.position.subjectId) ?? { sum: 0, n: 0, marks: [] };
      slot.sum += mark.scorePct;
      slot.n += 1;
      slot.marks.push({
        assessmentName: mark.assessmentName,
        kind: mark.kind,
        pct: mark.scorePct,
        heldOn: mark.heldOn,
      });
      bySubject.set(mark.position.subjectId, slot);
    }
    const names = await deps.directory.namesFor([...bySubject.keys()]);
    const subjects = [...bySubject.entries()].map(([subjectId, slot]) => ({
      subjectId,
      name: names.get(subjectId) ?? subjectId,
      avgPct: Math.round((slot.sum / slot.n) * 10) / 10,
      marks: slot.marks,
    }));
    const overallPct =
      rows.length === 0
        ? null
        : Math.round((rows.reduce((sum, mark) => sum + mark.scorePct, 0) / rows.length) * 10) / 10;
    return { status: 200, body: { subjects, overallPct } };
  };

  const schoolMarks = (resolve: Resolver): RouteHandler => async (ctx) => {
    if (deps.edition !== "school" || deps.schoolAcademicsRead === undefined) return { status: 404, body: { message: "school marks are unavailable in this edition" } };
    const student = await resolve(ctx);
    if (isResult(student)) return student;
    const { academicYear } = ctx.request.query as { academicYear: string };
    const position = await deps.directory.studentPositionForAcademicYear(student.studentId, academicYear);
    if (position?.classId === undefined || position.collegeId !== student.collegeId) {
      return { status: 200, body: { terms: [] } };
    }
    const terms = (await deps.schoolAcademicsRead.listTermsForColleges([student.collegeId]))
      .filter((term) => term.academicYear === academicYear && term.status === "closed" && term.marksReleasedAt !== null)
      .sort((a, b) => b.endsOn.localeCompare(a.endsOn) || a.name.localeCompare(b.name));
    const released = [];
    for (const term of terms) {
      const source = await deps.schoolAcademicsRead.termResultSource(student.studentId, position.classId, term.id);
      // Recheck the status on the fresh source: reopening immediately hides draft corrections.
      if (source === null || source.term.status !== "closed" || source.term.marksReleasedAt === null || source.term.collegeId !== student.collegeId || source.term.academicYear !== academicYear || source.subjects.length === 0) continue;
      released.push(await schoolTermMarks(source, deps.directory));
    }
    return { status: 200, body: { terms: released } };
  };

  /** The pupil's live section (via enrollment position); "" when unenrolled. */
  async function sectionOf(resolve: Resolver, ctx: RouteContext): Promise<{ sectionId: string; collegeId: string } | RouteResult> {
    const student = await resolve(ctx);
    if (isResult(student)) return student;
    const position = await deps.directory.studentPosition(student.studentId);
    return { sectionId: position?.sectionId ?? "", collegeId: student.collegeId };
  }

  const timetable = (resolve: Resolver): RouteHandler => async (ctx) => {
    const own = await sectionOf(resolve, ctx);
    if ("status" in own) return own;
    const query = ctx.request.query as { academicYear: string };
    const periods = await deps.timetableRead.periods(own.collegeId);
    const entries = own.sectionId === "" ? [] : await deps.timetableRead.sectionGrid(own.sectionId, query.academicYear);
    return { status: 200, body: { periods, entries } };
  };

  const today = (resolve: Resolver): RouteHandler => async (ctx) => {
    const own = await sectionOf(resolve, ctx);
    if ("status" in own) return own;
    const query = ctx.request.query as { academicYear: string };
    const day = collegeDayOfWeek();
    const periods = await deps.timetableRead.periods(own.collegeId);
    const entries =
      day === 0 || own.sectionId === ""
        ? []
        : await deps.timetableRead.sectionDay(own.sectionId, query.academicYear, day);
    return { status: 200, body: { dayOfWeek: day, periods, entries } };
  };

  return {
    "portal.me": me,
    "portal.my-attendance": attendance(self),
    "portal.my-marks": marks(self),
    "portal.my-timetable": timetable(self),
    "portal.my-today": today(self),
    "portal.child-attendance": attendance(child("attendance")),
    "portal.child-marks": marks(child("marks")),
    "portal.my-school-marks": schoolMarks(self),
    "portal.child-school-marks": schoolMarks(child("marks")),
    "portal.child-timetable": timetable(child("timetable")),
    "portal.child-today": today(child("timetable")),
  };
}
