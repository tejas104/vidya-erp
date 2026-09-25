import type { Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { SCHOOL_DAILY_ATTENDANCE_POLICY, attendanceRef, summarizeAttendance } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TermsRepo } from "./repo";
import { termRef } from "./resource-refs";
import type { SchTermRow } from "./db/schema";

interface Deps {
  terms: TermsRepo;
  directory: PeopleDirectory;
  scopeChecker: ScopeChecker;
  academics: AcademicsReadModel;
}

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

export function createAttendanceReviewHandlers(deps: Deps): Record<string, RouteHandler> {
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
    const [term, path] = await Promise.all([deps.terms.get(termId), deps.directory.sectionPath(sectionId)]);
    if (!term || !path || !path.departmentId || !path.classId || path.collegeId !== term.collegeId || path.departmentId !== term.departmentId) return { status: 404, body: { message: "No such section in this term's school." } };
    const principal = ctx.principal as Principal;
    if (!deps.scopeChecker.check(principal, "read", attendanceRef({ collegeId: path.collegeId, departmentId: path.departmentId, classId: path.classId, sectionId })).granted) return { status: 403, body: { message: "Access denied." } };
    if (term.instructionalDays === null || term.shortfallThreshold === null) return { status: 409, body: { message: "Configure this term's instructional days and threshold first." } };
    const today = schoolToday();
    const until = [through ?? today, today, term.endsOn].sort()[0]!;
    const scheduledDates = term.instructionalDays.filter((date) => date <= until);
    const dailyRegisters = until < term.startsOn ? [] : await deps.academics.sectionDailyRegisterWindow(sectionId, term.startsOn, until);
    const registerByDate = new Map(dailyRegisters.map((day) => [day.heldOn, day]));
    const unsubmittedDates = scheduledDates.filter((date) => !registerByDate.has(date));
    const roster = (await deps.directory.sectionRoster(sectionId)).filter((student) => student.academicYear === term.academicYear);
    const names = await deps.directory.studentsBrief(roster.map((student) => student.studentId));
    const students = roster.map(({ studentId }) => {
      const records = dailyRegisters.flatMap((day) => day.entries.filter((entry) => entry.studentId === studentId).map((entry) => ({ date: day.heldOn, status: entry.status })));
      const outcome = summarizeAttendance({ policy: SCHOOL_DAILY_ATTENDANCE_POLICY, interval: { from: term.startsOn, to: until < term.startsOn ? term.startsOn : until }, calendar: { instructionalDays: scheduledDates }, enrollments: [{ from: term.startsOn, to: null }], records });
      if (!outcome.ok) throw new Error(`Attendance source is inconsistent: ${outcome.code}`);
      const summary = outcome.result;
      const brief = names.get(studentId);
      return { studentId, fullName: brief?.fullName ?? "Student", admissionNo: brief?.admissionNo ?? "", expectedDays: summary.expectedDays, recordedDays: summary.recordedDays, absentDays: summary.statusTotals.absent, missingEntryDates: summary.missingDates.filter((date) => registerByDate.has(date)), percentageDenominator: summary.percentageDenominator, percentage: summary.percentage, shortfall: summary.percentage === null ? null : summary.percentage < Number(term.shortfallThreshold) };
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { status: 200, body: { termId, sectionId, through: until, calendarVersion: term.calendarVersion, threshold: Number(term.shortfallThreshold), scheduledDates, unsubmittedDates, rosterAssumption: "Current section roster is assumed enrolled throughout this term window; historical enrollment dates are unavailable.", students } };
  };
  return { "school-academics.calendar": calendar(false), "school-academics.calendar-set": calendar(true), "school-academics.attendance-shortfall": shortfall };
}
