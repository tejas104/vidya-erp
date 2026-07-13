import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "leave";
export const TABLE_PREFIX = "lvs_";

const idSchema = z.string().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like "2026-11-02"');
const kindSchema = z.enum(["casual", "sick", "duty"]);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const leaveRequestViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  departmentId: z.string().nullable(),
  teacherId: z.string(),
  teacherName: z.string(),
  fromOn: z.string(),
  toOn: z.string(),
  kind: kindSchema,
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

const routes: RouteSpec[] = [
  {
    id: "leave.apply",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/leave/requests",
    summary: "Apply for leave (staff self) — routes to the HOD or principal",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    request: {
      body: z.object({
        fromOn: dateSchema,
        toOn: dateSchema,
        kind: kindSchema,
        reason: z.string().trim().min(1).max(500),
        departmentId: idSchema.optional(),
      }),
    },
    audit: { action: "leave.applied", resourceType: "leave-request" },
    responses: {
      201: { description: "Applied", schema: leaveRequestViewSchema },
      404: { description: "This sign-in is not linked to a staff record", schema: problemSchema },
      422: { description: "Invalid range or a departmentId not belonging to the teacher", schema: problemSchema },
    },
  },
  {
    id: "leave.my-requests",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/leave/mine",
    summary: "The signed-in staff member's own leave requests, newest first",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Own requests", schema: z.object({ requests: z.array(leaveRequestViewSchema) }) },
      404: { description: "Not linked to a staff record", schema: problemSchema },
    },
  },
  {
    id: "leave.pending-for-me",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/leave/pending",
    summary: "Pending requests the caller can decide (HOD: their dept · principal: college)",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Pending requests, newest first", schema: z.object({ requests: z.array(leaveRequestViewSchema) }) },
    },
  },
  {
    id: "leave.decide",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/leave/requests/{requestId}/decide",
    summary: "Approve or reject a pending request (HOD/principal) — reject needs a note",
    tags: ["leave"],
    auth: ANY_AUTHENTICATED,
    request: {
      params: z.object({ requestId: idSchema }),
      body: z.object({
        status: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(500).optional(),
      }),
    },
    audit: { action: "leave.decided", resourceType: "leave-request" },
    responses: {
      200: { description: "Decided", schema: leaveRequestViewSchema },
      403: { description: "Not the applicant's approver, or deciding own request", schema: problemSchema },
      404: { description: "No such request", schema: problemSchema },
      409: { description: "Already decided", schema: problemSchema },
      422: { description: "Reject without a note", schema: problemSchema },
    },
  },
];

export const leaveModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
