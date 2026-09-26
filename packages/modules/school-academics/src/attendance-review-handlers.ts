import type { Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { SCHOOL_DAILY_ATTENDANCE_POLICY, attendanceRef, summarizeAttendance } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TermsRepo } from "./repo";
import { termRef } from "./resource-refs";
import type { SchTermRow } from "./db/schema";
import type { AttendanceReview } from "./definition";

interface Deps {
  terms: TermsRepo;
  directory: PeopleDirectory;
  scopeChecker: ScopeChecker;
  academics: AcademicsReadModel;
}

export type AttendanceReviewSourceResult =
  | { access: "ok"; data: AttendanceReview; termName: string; sectionName: string; academicYear: string }
  | { access: "not-found" | "forbidden" | "unconfigured" };
export type AttendanceReviewSource = (principal: Principal, sectionId: string, termId: string, through?: string, academicYear?: string) => Promise<AttendanceReviewSourceResult>;

/** School edition currently uses the Indian school day until per-school time zones exist. */
function schoolToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function view(term: SchTermRow) {
  return {
    termId: term.id,
    instructionalDays: term.instructionalDays,
    shortfallThreshold: term.shortfallThreshold === null ? null : Number(term.shortfallThreshold),
    version: term.calendarVersion,
    locked: term.status === "closed",
  };
}

/** One scoped calculation supplies both the live screen and queued exports. */
export function createAttendanceReviewSource(deps: Deps): AttendanceReviewSource {
  return async (principal, sectionId, termId, through, academicYear) => {
    const [term, path] = await Promise.all([deps.terms.get(termId), deps.directory.sectionPath(sectionId)]);
    if (!term || !path || !path.departmentId || !path.classId || path.collegeId !== term.collegeId || path.departmentId !== term.departmentId || (academicYear && term.academicYear !== academicYear)) return { access: "not-found" };
    if (!deps.scopeChecker.check(principal, "read", attendanceRef({ collegeId: path.collegeId, departmentId: path.departmentId, classId: path.classId, sectionId })).granted) return { access: "forbidden" };
    if (term.instructionalDays === null || term.shortfallThreshold === null) return { access: "unconfigured" };
    const today = schoolToday();
    const until = [through ?? today, today, term.endsOn].sort()[0]!;
    const scheduledDates = term.instructionalDays.filter((date) => date <= until);
    const dailyRegisters = until < term.startsOn ? [] : await deps.academics.sectionDailyRegisterWindow(sectionId, term.startsOn, until);
    const registerByDate = new Map(dailyRegisters.map((day) => [day.heldOn, day]));
    const history = await deps.directory.sectionEnrollmentHistory(sectionId, term.academicYear);
    const unsubmittedDates = scheduledDates.filter((date) => history.some((window) => window.startsOn !== null && window.startsOn <= date && (window.status === "enrolled" || window.endsOn !== null) && (window.endsOn === null || date <= window.endsOn)) && !registerByDate.has(date));
    const byStudent = new Map<string, typeof history>();
    for (const enrollment of history) byStudent.set(enrollment.studentId, [...(byStudent.get(enrollment.studentId) ?? []), enrollment]);
    const names = await deps.directory.studentsBrief([...byStudent.keys()]);
    const students = [...byStudent].map(([studentId, windows]) => {
      const dateIssue = windows.some((window) => window.startsOn === null) ? "Enrollment start date needs verification"
        : windows.some((window) => window.status !== "enrolled" && window.endsOn === null) ? "Past enrollment end date needs verification" : null;
      const brief = names.get(studentId);
      if (dateIssue) return { studentId, fullName: brief?.fullName ?? "Student", admissionNo: brief?.admissionNo ?? "", enrollmentDates: windows.map((window) => ({ from: window.startsOn, to: window.endsOn })), dateIssue, expectedDays: null, recordedDays: null, absentDays: null, missingEntryDates: [], percentageDenominator: null, percentage: null, shortfall: null };
      const records = dailyRegisters.flatMap((day) => day.entries.filter((entry) => entry.studentId === studentId).map((entry) => ({ date: day.heldOn, status: entry.status })));
      const enrollments = windows.map((window) => ({ from: window.startsOn!, to: window.endsOn }));
      const outcome = summarizeAttendance({ policy: SCHOOL_DAILY_ATTENDANCE_POLICY, interval: { from: term.startsOn, to: until < term.startsOn ? term.startsOn : until }, calendar: { instructionalDays: scheduledDates }, enrollments, records });
      if (!outcome.ok) throw new Error(`Attendance source is inconsistent: ${outcome.code}`);
      const summary = outcome.result;
      return { studentId, fullName: brief?.fullName ?? "Student", admissionNo: brief?.admissionNo ?? "", enrollmentDates: windows.map((window) => ({ from: window.startsOn, to: window.endsOn })), dateIssue: null, expectedDays: summary.expectedDays, recordedDays: summary.recordedDays, absentDays: summary.statusTotals.absent, missingEntryDates: summary.missingDates.filter((date) => registerByDate.has(date)), percentageDenominator: summary.percentageDenominator, percentage: summary.percentage, shortfall: summary.percentage === null ? null : summary.percentage < Number(term.shortfallThreshold) };
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const sectionName = (await deps.directory.namesFor([sectionId])).get(sectionId) ?? "Section";
    return { access: "ok", termName: term.name, sectionName, academicYear: term.academicYear, data: { termId, sectionId, through: until, calendarVersion: term.calendarVersion, threshold: Number(term.shortfallThreshold), scheduledDates, unsubmittedDates, students } };
  };
}

export function createAttendanceReviewHandlers(deps: Deps, source: AttendanceReviewSource = createAttendanceReviewSource(deps)): Record<string, RouteHandler> {
  const calendar = (write: boolean): RouteHandler => async (ctx) => {
    const { termId } = ctx.request.params as { termId: string };
    const term = await deps.terms.get(termId);
    if (!term) return { status: 404, body: { message: "No such term." } };
    const principal = ctx.principal as Principal;
    if (!deps.scopeChecker.check(principal, "read", termRef(term)).granted) return { status: 403, body: { message: "Access denied." } };
    if (!write) return { status: 200, body: view(term) };
    if (!principal.roles.includes("admin")) return { status: 403, body: { message: "Only an administrator can set instructional days." } };
    if (term.status !== "open") return { status: 409, body: { message: "Reopen the term before changing its calendar." } };
    const input = ctx.request.body as { instructionalDays: string[]; shortfallThreshold: number; expectedVersion: number };
    const unique = new Set(input.instructionalDays);
    if (unique.size !== input.instructionalDays.length || input.instructionalDays.some((date) => date < term.startsOn || date > term.endsOn)) {
      return { status: 422, body: { message: "Dates must be unique and within the term." } };
    }
    const updated = await deps.terms.setCalendar({ id: term.id, expectedVersion: input.expectedVersion, instructionalDays: [...unique].sort(), shortfallThreshold: input.shortfallThreshold });
    if (!updated) return { status: 409, body: { message: "The term or calendar changed. Reload before saving." } };
    return { status: 200, body: view(updated), audit: { org: termRef(term).org, resourceId: term.id, details: { beforeVersion: term.calendarVersion, afterVersion: updated.calendarVersion, previousDates: term.instructionalDays, instructionalDays: updated.instructionalDays, previousThreshold: term.shortfallThreshold, shortfallThreshold: updated.shortfallThreshold } } };
  };

  const shortfall: RouteHandler = async (ctx) => {
    const { sectionId } = ctx.request.params as { sectionId: string };
    const { termId, through } = ctx.request.query as { termId: string; through?: string };
    const result = await source(ctx.principal as Principal, sectionId, termId, through);
    if (result.access === "ok") return { status: 200, body: result.data };
    if (result.access === "not-found") return { status: 404, body: { message: "No such section in this term's school." } };
    if (result.access === "forbidden") return { status: 403, body: { message: "Access denied." } };
    return { status: 409, body: { message: "Configure this term's instructional days and threshold first." } };
  };
  return { "school-academics.calendar": calendar(false), "school-academics.calendar-set": calendar(true), "school-academics.attendance-shortfall": shortfall };
}
