import type { OrgPath, Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TimetableReadModel } from "@vidya/module-timetable";
import { DuplicateSeriesError, DuplicateSlotError, type ExamsRepo } from "./repo";
import type { ExamSeriesRow, ExamSlotRow } from "./db/schema";

export interface ExamsHandlerDeps {
  readonly repo: ExamsRepo;
  readonly directory: PeopleDirectory;
  readonly timetable: TimetableReadModel;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}

function inCollege(principal: Principal, collegeId: string): boolean {
  return principal.grants.some((grant) => grant.org.collegeId === collegeId);
}

/** Same overlap rule as the noticeboard: no defined level may contradict. */
export function orgOverlaps(a: OrgPath, b: OrgPath): boolean {
  if (a.collegeId !== b.collegeId) return false;
  if (a.departmentId !== undefined && b.departmentId !== undefined && a.departmentId !== b.departmentId) return false;
  if (a.classId !== undefined && b.classId !== undefined && a.classId !== b.classId) return false;
  return true;
}

/** ISO weekday for a yyyy-mm-dd date: 1=Mon … 7=Sun (timetable uses 1–6). */
export function isoWeekday(onDate: string): number {
  const day = new Date(`${onDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function createExamsHandlers(deps: ExamsHandlerDeps): Record<string, RouteHandler> {
  async function slotView(row: ExamSlotRow, seriesName?: string) {
    const names = await deps.directory.namesFor([row.subjectId, ...(seriesName === undefined ? [row.seriesId] : [])]);
    return {
      id: row.id,
      seriesId: row.seriesId,
      seriesName: seriesName ?? (await deps.repo.getSeries(row.seriesId))?.name ?? row.seriesId,
      classId: row.classId,
      subjectId: row.subjectId,
      subjectName: names.get(row.subjectId) ?? row.subjectId,
      onDate: row.onDate,
      starts: row.starts,
      ends: row.ends,
      room: row.room,
    };
  }

  function seriesView(row: ExamSeriesRow & { slotCount?: number }) {
    return {
      id: row.id,
      collegeId: row.collegeId,
      name: row.name,
      academicYear: row.academicYear,
      term: row.term,
      slotCount: row.slotCount ?? 0,
    };
  }

  /** Advisory room clash: does the slot's date/time land on a timetabled lesson
   * in the same room? Warns with "Room 12 busy: FY CS Data Structures". */
  async function clashFor(
    collegeId: string,
    room: string,
    onDate: string,
    starts: string,
    ends: string,
    academicYear: string,
  ): Promise<string | undefined> {
    if (room === "") return undefined;
    const dayOfWeek = isoWeekday(onDate);
    const [entries, periods] = await Promise.all([
      deps.timetable.roomDay(collegeId, room, academicYear, dayOfWeek),
      deps.timetable.periods(collegeId),
    ]);
    const periodTimes = new Map(periods.map((period) => [period.periodNo, period]));
    for (const entry of entries) {
      const period = periodTimes.get(entry.periodNo);
      if (period === undefined) continue;
      if (period.starts < ends && period.ends > starts) {
        const path = await deps.directory.sectionPath(entry.sectionId);
        const className =
          path?.classId !== undefined
            ? ((await deps.directory.namesFor([path.classId])).get(path.classId) ?? "")
            : "";
        return `Room ${room} busy: ${className === "" ? "" : `${className} `}${entry.subjectName}`.trim();
      }
    }
    return undefined;
  }

  const seriesCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; name: string; academicYear: string; term: string };
    if (!(await deps.directory.collegeExists(body.collegeId))) return notFound("no such college");
    if (!inCollege(principal, body.collegeId)) return denied();
    try {
      const row = await deps.repo.createSeries({ ...body, term: body.term.trim() });
      return { status: 201, body: seriesView(row), audit: { resourceId: row.id, details: { name: row.name, academicYear: row.academicYear } } };
    } catch (error) {
      if (error instanceof DuplicateSeriesError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const seriesList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string; academicYear: string };
    if (!inCollege(principal, query.collegeId)) return denied();
    const rows = await deps.repo.listSeries(query.collegeId, query.academicYear);
    return { status: 200, body: { series: rows.map(seriesView) } };
  };

  const seriesDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { seriesId: string };
    const row = await deps.repo.getSeries(params.seriesId);
    if (row === null) return notFound("no such series");
    if (!inCollege(principal, row.collegeId)) return denied();
    await deps.repo.deleteSeries(row.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: row.id, details: { name: row.name } } };
  };

  const slotCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      seriesId: string; classId: string; subjectId: string;
      onDate: string; starts: string; ends: string; room: string;
    };
    const series = await deps.repo.getSeries(body.seriesId);
    if (series === null) return notFound("no such series");
    if (!inCollege(principal, series.collegeId)) return denied();
    const position = await deps.directory.classPath(body.classId);
    if (position === null || position.collegeId !== series.collegeId || position.departmentId === undefined) {
      return notFound("no such class in this college");
    }
    const subjectDept = await deps.directory.subjectDepartment(body.subjectId);
    if (subjectDept === null || subjectDept !== position.departmentId) {
      return notFound("no such subject in this class's department");
    }
    if (body.ends <= body.starts) {
      return { status: 422, body: { message: "the paper would end before it starts" } };
    }
    try {
      const row = await deps.repo.createSlot({
        collegeId: series.collegeId,
        departmentId: position.departmentId,
        classId: body.classId,
        seriesId: series.id,
        subjectId: body.subjectId,
        academicYear: series.academicYear,
        onDate: body.onDate,
        starts: body.starts,
        ends: body.ends,
        room: body.room,
      });
      const clash = await clashFor(series.collegeId, row.room, row.onDate, row.starts, row.ends, series.academicYear);
      return {
        status: 201,
        body: { ...(await slotView(row, series.name)), ...(clash !== undefined ? { clash } : {}) },
        audit: { resourceId: row.id, details: { seriesId: series.id, classId: row.classId, subjectId: row.subjectId, onDate: row.onDate } },
      };
    } catch (error) {
      if (error instanceof DuplicateSlotError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const slotDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { slotId: string };
    const row = await deps.repo.getSlot(params.slotId);
    if (row === null) return notFound("no such slot");
    if (!inCollege(principal, row.collegeId)) return denied();
    await deps.repo.deleteSlot(row.id);
    return { status: 200, body: { ok: true as const }, audit: { resourceId: row.id, details: { onDate: row.onDate, subjectId: row.subjectId } } };
  };

  const classSchedule: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const position = await deps.directory.classPath(params.classId);
    if (position === null) return notFound("no such class");
    if (!principal.grants.some((grant) => orgOverlaps(grant.org, position))) return denied();
    const rows = await deps.repo.slotsForClass(params.classId, query.academicYear);
    return { status: 200, body: { slots: await viewAll(rows) } };
  };

  const mySchedule: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const own = await deps.directory.studentByIdentityUser(principal.id);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const position = await deps.directory.studentPosition(own.studentId);
    const classId = position?.classId;
    if (classId === undefined) return { status: 200, body: { slots: [] } };
    const rows = await deps.repo.slotsForClass(classId);
    return { status: 200, body: { slots: await viewAll(rows) } };
  };

  /** Batched view: resolves subject + series names once for the whole list. */
  async function viewAll(rows: ExamSlotRow[]) {
    const names = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    const seriesNames = new Map<string, string>();
    for (const row of rows) {
      if (!seriesNames.has(row.seriesId)) {
        seriesNames.set(row.seriesId, (await deps.repo.getSeries(row.seriesId))?.name ?? row.seriesId);
      }
    }
    return rows.map((row) => ({
      id: row.id,
      seriesId: row.seriesId,
      seriesName: seriesNames.get(row.seriesId)!,
      classId: row.classId,
      subjectId: row.subjectId,
      subjectName: names.get(row.subjectId) ?? row.subjectId,
      onDate: row.onDate,
      starts: row.starts,
      ends: row.ends,
      room: row.room,
    }));
  }

  return {
    "exams.series-create": seriesCreate,
    "exams.series-list": seriesList,
    "exams.series-delete": seriesDelete,
    "exams.slot-create": slotCreate,
    "exams.slot-delete": slotDelete,
    "exams.class-schedule": classSchedule,
    "exams.my-schedule": mySchedule,
  };
}

// ---------------------------------------------------------------------------
// Hall-ticket read surface for the reporting module (injected — same seam as
// the results grade card; reporting never imports this module).
// ---------------------------------------------------------------------------

export interface HallTicketData {
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  slots: { seriesName: string; subjectName: string; onDate: string; starts: string; ends: string; room: string }[];
}

export type HallTicketResult =
  | { access: "ok"; data: HallTicketData }
  | { access: "forbidden" }
  | { access: "not-found" };

export type HallTicketSource = (principal: Principal, studentId: string) => Promise<HallTicketResult>;

export function createHallTicketSource(
  deps: Pick<ExamsHandlerDeps, "repo" | "directory">,
): HallTicketSource {
  return async (principal, studentId) => {
    const brief = (await deps.directory.studentsBrief([studentId])).get(studentId);
    if (brief === undefined) return { access: "not-found" };
    const position = await deps.directory.studentPosition(studentId);
    if (position === null || position.classId === undefined) return { access: "not-found" };

    const own = await deps.directory.studentByIdentityUser(principal.id);
    const isSelf = own !== null && own.studentId === studentId;
    const staffCovers = principal.grants.some((grant) => orgOverlaps(grant.org, position));
    if (!isSelf && !staffCovers) return { access: "forbidden" };

    const classId = position.classId;
    const names = await deps.directory.namesFor([classId]);
    const rows = await deps.repo.slotsForClass(classId);
    const subjectNames = await deps.directory.namesFor(rows.map((row) => row.subjectId));
    const slots = [];
    for (const row of rows) {
      slots.push({
        seriesName: (await deps.repo.getSeries(row.seriesId))?.name ?? row.seriesId,
        subjectName: subjectNames.get(row.subjectId) ?? row.subjectId,
        onDate: row.onDate,
        starts: row.starts,
        ends: row.ends,
        room: row.room,
      });
    }
    return {
      access: "ok",
      data: {
        studentId,
        studentName: brief.fullName,
        admissionNo: brief.admissionNo,
        className: names.get(classId) ?? classId,
        slots,
      },
    };
  };
}
