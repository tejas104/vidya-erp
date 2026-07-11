import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "portal";
/** No tables — the portal is a pure serving layer over other modules' reads. */
export const TABLE_PREFIX = "ptl_";

export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

/**
 * Every portal route is STUDENT-ONLY and self-scoped: the caller's linked
 * student record is resolved server-side from the identity link — no route
 * ever accepts a studentId. An unlinked student sign-in answers 404.
 */
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };

const meSchema = z.object({
  student: z.object({
    id: z.string(),
    admissionNo: z.string(),
    fullName: z.string(),
    status: z.string(),
  }),
  enrollment: z
    .object({
      sectionId: z.string(),
      sectionName: z.string(),
      className: z.string(),
      academicYear: z.string(),
    })
    .nullable(),
});

const attendanceSchema = z.object({
  counts: z.object({
    present: z.number(),
    absent: z.number(),
    late: z.number(),
    excused: z.number(),
  }),
  pct: z.number().nullable(),
  monthly: z.array(z.object({ month: z.string(), pct: z.number() })),
  sessions: z.array(
    z.object({ heldOn: z.string(), status: z.enum(["present", "absent", "late", "excused"]) }),
  ),
});

const marksSchema = z.object({
  subjects: z.array(
    z.object({
      subjectId: z.string(),
      name: z.string(),
      avgPct: z.number(),
      marks: z.array(
        z.object({
          assessmentName: z.string(),
          kind: z.string(),
          pct: z.number(),
          heldOn: z.string().nullable(),
        }),
      ),
    }),
  ),
  overallPct: z.number().nullable(),
});

const yearQuery = z.object({ academicYear: academicYearSchema });

const routes: RouteSpec[] = [
  {
    id: "portal.me",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/portal/me",
    summary: "The signed-in student's own profile + live enrollment",
    tags: ["portal"],
    auth: STUDENT_ONLY,
    responses: {
      200: { description: "The linked student", schema: meSchema },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
  {
    id: "portal.my-attendance",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/portal/attendance",
    summary: "The signed-in student's own attendance (self-scoped)",
    tags: ["portal"],
    auth: STUDENT_ONLY,
    request: { query: yearQuery },
    responses: {
      200: { description: "Own attendance", schema: attendanceSchema },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
  {
    id: "portal.my-marks",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/portal/marks",
    summary: "The signed-in student's own marks by subject (self-scoped)",
    tags: ["portal"],
    auth: STUDENT_ONLY,
    request: { query: yearQuery },
    responses: {
      200: { description: "Own marks", schema: marksSchema },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
];

export const portalModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
