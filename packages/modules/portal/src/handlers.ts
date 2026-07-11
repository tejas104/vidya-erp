import type { Principal, RouteHandler } from "@vidya/platform";
import type { AcademicsReadModel } from "@vidya/module-academics";
import type { PeopleDirectory } from "@vidya/module-people";

export interface PortalHandlerDeps {
  readonly directory: PeopleDirectory;
  readonly academicsRead: AcademicsReadModel;
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

  const myAttendance: RouteHandler = async (ctx) => {
    const student = await linkedStudent(ctx.principal as Principal);
    if (student === null) {
      return notLinked();
    }
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

  const myMarks: RouteHandler = async (ctx) => {
    const student = await linkedStudent(ctx.principal as Principal);
    if (student === null) {
      return notLinked();
    }
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

  return {
    "portal.me": me,
    "portal.my-attendance": myAttendance,
    "portal.my-marks": myMarks,
  };
}
