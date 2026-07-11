import type { Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { SlotClashError, type TimetableRepo, type TtbEntryRowLike } from "./read-model";

export interface TimetableHandlerDeps {
  readonly repo: TimetableRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}

/** JS getDay() → our Mon=1..Sat=6 (Sunday → 0, meaning "no periods today"). */
export function collegeDayOfWeek(date = new Date()): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 0 : jsDay;
}

async function entryView(
  directory: PeopleDirectory,
  rows: TtbEntryRowLike[],
): Promise<
  {
    id: string;
    sectionId: string;
    subjectId: string;
    subjectName: string;
    teacherId: string;
    teacherName: string;
    room: string;
    dayOfWeek: number;
    periodNo: number;
  }[]
> {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.subjectId);
    ids.add(row.teacherId);
  }
  const names = await directory.namesFor([...ids]);
  return rows.map((row) => ({
    id: row.id,
    sectionId: row.sectionId,
    subjectId: row.subjectId,
    subjectName: names.get(row.subjectId) ?? row.subjectId,
    teacherId: row.teacherId,
    teacherName: names.get(row.teacherId) ?? row.teacherId,
    room: row.room,
    dayOfWeek: row.dayOfWeek,
    periodNo: row.periodNo,
  }));
}

export function createTimetableHandlers(deps: TimetableHandlerDeps): Record<string, RouteHandler> {
  const periodsGet: RouteHandler = async (ctx) => {
    const params = ctx.request.params as { collegeId: string };
    const periods = await deps.repo.periodsFor(params.collegeId);
    return {
      status: 200,
      body: { periods: periods.map((p) => ({ periodNo: p.periodNo, starts: p.starts, ends: p.ends })) },
    };
  };

  const periodsSet: RouteHandler = async (ctx) => {
    const params = ctx.request.params as { collegeId: string };
    const body = ctx.request.body as { periods: { periodNo: number; starts: string; ends: string }[] };
    if (!(await deps.directory.collegeExists(params.collegeId))) {
      return notFound("no such college");
    }
    await deps.repo.setPeriods(params.collegeId, body.periods);
    return {
      status: 200,
      body: { ok: true as const },
      audit: { resourceId: params.collegeId, details: { periods: body.periods.length } },
    };
  };

  const entryCreate: RouteHandler = async (ctx) => {
    const body = ctx.request.body as {
      sectionId: string;
      subjectId: string;
      teacherId: string;
      room: string;
      dayOfWeek: number;
      periodNo: number;
      academicYear: string;
    };
    const path = await deps.directory.sectionPath(body.sectionId);
    if (path === null || path.departmentId === undefined || path.classId === undefined || path.sectionId === undefined) {
      return notFound("no such section");
    }
    const subjectDept = await deps.directory.subjectDepartment(body.subjectId);
    if (subjectDept === null) {
      return notFound("no such subject");
    }
    if (subjectDept !== path.departmentId) {
      return { status: 422, body: { message: "subject does not belong to the section's department" } };
    }
    try {
      const row = await deps.repo.createEntry({
        collegeId: path.collegeId,
        departmentId: path.departmentId,
        classId: path.classId,
        sectionId: path.sectionId,
        subjectId: body.subjectId,
        teacherId: body.teacherId,
        room: body.room,
        dayOfWeek: body.dayOfWeek,
        periodNo: body.periodNo,
        academicYear: body.academicYear,
      });
      const [view] = await entryView(deps.directory, [row]);
      return { status: 201, body: view!, audit: { resourceId: row.id, details: { ...body } } };
    } catch (error) {
      if (error instanceof SlotClashError) {
        return {
          status: 409,
          body: { message: `that ${error.resource} is already booked in that period` },
        };
      }
      throw error;
    }
  };

  const entryDelete: RouteHandler = async (ctx) => {
    const params = ctx.request.params as { entryId: string };
    const entry = await deps.repo.getEntry(params.entryId);
    if (entry === null) {
      return notFound("no such entry");
    }
    await deps.repo.deleteEntry(params.entryId);
    return {
      status: 200,
      body: { ok: true as const },
      audit: { resourceId: params.entryId, details: { sectionId: entry.sectionId, dayOfWeek: entry.dayOfWeek, periodNo: entry.periodNo } },
    };
  };

  const sectionGrid: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sectionId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.sectionPath(params.sectionId);
    if (path === null) {
      return notFound("no such section");
    }
    const decision = deps.scopeChecker.check(principal, "read", {
      module: "timetable",
      resourceType: "timetable-entry",
      org: path,
    });
    if (!decision.granted) {
      ctx.logger.warn({ sectionId: params.sectionId }, "timetable grid denied");
      return { status: 403, body: { message: "access denied" } };
    }
    const [periods, rows] = await Promise.all([
      deps.repo.periodsFor(path.collegeId),
      deps.repo.entriesForSection(params.sectionId, query.academicYear),
    ]);
    return {
      status: 200,
      body: {
        periods: periods.map((p) => ({ periodNo: p.periodNo, starts: p.starts, ends: p.ends })),
        entries: await entryView(deps.directory, rows),
      },
    };
  };

  const myToday: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { academicYear: string };
    const teacher = await deps.directory.teacherByIdentityUser(principal.id);
    if (teacher === null) {
      return notFound("this sign-in is not linked to a teacher record");
    }
    const day = collegeDayOfWeek();
    const periods = await deps.repo.periodsFor(teacher.collegeId);
    const rows = day === 0 ? [] : await deps.repo.entriesForTeacherDay(teacher.teacherId, query.academicYear, day);
    const base = await entryView(deps.directory, rows);
    const orgIds = new Set<string>();
    for (const row of rows) {
      orgIds.add(row.sectionId);
      orgIds.add(row.classId);
    }
    const names = await deps.directory.namesFor([...orgIds]);
    const entries = base.map((view, index) => {
      const row = rows[index]!;
      return {
        ...view,
        sectionName: names.get(row.sectionId) ?? row.sectionId,
        className: names.get(row.classId) ?? row.classId,
      };
    });
    return {
      status: 200,
      body: {
        dayOfWeek: day,
        periods: periods.map((p) => ({ periodNo: p.periodNo, starts: p.starts, ends: p.ends })),
        entries,
      },
    };
  };

  return {
    "timetable.periods-get": periodsGet,
    "timetable.periods-set": periodsSet,
    "timetable.entry-create": entryCreate,
    "timetable.entry-delete": entryDelete,
    "timetable.section-grid": sectionGrid,
    "timetable.my-today": myToday,
  };
}
