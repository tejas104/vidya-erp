import type { Principal, RouteHandler } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { QueryService } from "../service/query-service";
import type { ScopeLevel } from "../repo/rollups-repo";
import type { rollupJobPayloadSchema } from "../definition";
import type { z } from "zod";

export interface AnalyticsHandlerDeps {
  readonly query: QueryService;
  readonly directory: PeopleDirectory;
  readonly enqueueRollup: (payload: z.infer<typeof rollupJobPayloadSchema>) => Promise<void>;
}

function notFound() {
  return { status: 404, body: { message: "not found" } };
}

export function createAnalyticsHandlers(deps: AnalyticsHandlerDeps): Record<string, RouteHandler> {
  const dashboard: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { academicYear: string };
    const body = await deps.query.dashboard(principal, query.academicYear);
    return { status: 200, body };
  };

  const rollup: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: ScopeLevel; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    const node = await deps.query.nodePath(params.level, params.nodeId);
    if (node === null) {
      return notFound();
    }
    const attendance = await deps.query.nodeAttendance(
      principal,
      params.nodeId,
      node,
      query.academicYear,
    );
    const marks = await deps.query.nodeMarks(principal, params.nodeId, node, query.academicYear);
    // If NOTHING is servable, the caller has no business at this node —
    // they get a uniform 403, not a map of which slots exist.
    const nothingServed =
      attendance.state === "denied" &&
      marks.bySubject.length === 0 &&
      marks.overall.state !== "ok" &&
      marks.overall.state !== "insufficient-cohort";
    if (nothingServed) {
      ctx.logger.warn({ nodeId: params.nodeId }, "rollup denied at every component");
      return { status: 403, body: { message: "access denied" } };
    }
    const names = await deps.directory.namesFor([
      params.nodeId,
      ...marks.bySubject.map((row) => row.subjectId),
    ]);
    return {
      status: 200,
      body: {
        node: {
          level: params.level,
          nodeId: params.nodeId,
          name: names.get(params.nodeId) ?? params.nodeId,
        },
        attendance,
        marks: {
          bySubject: marks.bySubject.map((row) => ({
            subjectId: row.subjectId,
            name: names.get(row.subjectId) ?? row.subjectId,
            summary: row.summary,
          })),
          overall: marks.overall,
        },
      },
    };
  };

  const atRisk: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: ScopeLevel; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    if ((await deps.query.nodePath(params.level, params.nodeId)) === null) {
      return notFound();
    }
    const students = await deps.query.atRisk(
      principal,
      params.level,
      params.nodeId,
      query.academicYear,
    );
    return { status: 200, body: { students } };
  };

  const studentPerformance: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const query = ctx.request.query as { academicYear: string };
    const result = await deps.query.studentPerformance(
      principal,
      params.studentId,
      query.academicYear,
    );
    if (result.state === "not-found") {
      return notFound();
    }
    if (result.state === "denied") {
      ctx.logger.warn({ studentId: params.studentId }, "student performance denied");
      return { status: 403, body: { message: "access denied" } };
    }
    const names = await deps.directory.namesFor([
      params.studentId,
      ...result.subjects.map((subject) => subject.subjectId),
    ]);
    return {
      status: 200,
      body: {
        studentId: params.studentId,
        name: names.get(params.studentId) ?? params.studentId,
        attendance: result.attendance,
        subjects: result.subjects.map((subject) => ({
          ...subject,
          name: names.get(subject.subjectId) ?? subject.subjectId,
        })),
        overallPct: result.overallPct,
      },
    };
  };

  const compare: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: "college" | "department" | "class"; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    const result = await deps.query.childrenRollups(principal, params.level, params.nodeId, query.academicYear);
    if (result === null) {
      return notFound();
    }
    const names = await deps.directory.namesFor([params.nodeId]);
    return {
      status: 200,
      body: {
        parent: { level: params.level, nodeId: params.nodeId, name: names.get(params.nodeId) ?? params.nodeId },
        childLevel: result.childLevel,
        children: result.children,
      },
    };
  };

  const distribution: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { level: "class" | "section"; nodeId: string };
    const query = ctx.request.query as { academicYear: string };
    const result = await deps.query.distribution(principal, params.level, params.nodeId, query.academicYear);
    if (result.state === "not-found") {
      return notFound();
    }
    const names = await deps.directory.namesFor([params.nodeId]);
    return {
      status: 200,
      body: {
        node: { level: params.level, nodeId: params.nodeId, name: names.get(params.nodeId) ?? params.nodeId },
        marks: result.marks,
        attendance: result.attendance,
      },
    };
  };

  const recompute: RouteHandler = async (ctx) => {
    const body = ctx.request.body as { academicYear: string };
    await deps.enqueueRollup({ academicYear: body.academicYear, source: "api" });
    return {
      status: 202,
      body: { enqueued: true as const },
      audit: { details: { academicYear: body.academicYear } },
    };
  };

  return {
    "analytics.dashboard": dashboard,
    "analytics.rollup": rollup,
    "analytics.at-risk": atRisk,
    "analytics.student-performance": studentPerformance,
    "analytics.recompute": recompute,
    "analytics.compare": compare,
    "analytics.distribution": distribution,
  };
}
