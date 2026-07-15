import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "notices";
export const TABLE_PREFIX = "ntc_";

export const idSchema = z.string().min(1).max(64);
/** college | staff | students | department:<id> | class:<id> */
export const audienceSchema = z
  .string()
  .regex(/^(college|staff|students|department:.{1,64}|class:.{1,64})$/, "audience like \"college\" or \"class:<id>\"");

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_OR_PRINCIPAL = {
  public: false as const,
  requirement: { rolesAnyOf: ["admin" as const, "principal" as const] },
};
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

/** notice | holiday | exam | event — colours a calendar entry. */
export const noticeKindSchema = z.enum(["notice", "holiday", "exam", "event"]);
export const eventDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");

export const noticeViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  audience: z.string(),
  /** The audience as a human word — "College-wide", "Staff", a department or class name. */
  audienceLabel: z.string(),
  kind: noticeKindSchema,
  /** Set when the row is also a calendar entry. */
  eventDate: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  publishAt: z.string(),
  expiresAt: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});

const routes: RouteSpec[] = [
  {
    id: "notices.create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/notices",
    summary: "Publish (or schedule) a notice to an audience (admin/principal)",
    tags: ["notices"],
    auth: ADMIN_OR_PRINCIPAL,
    request: {
      body: z.object({
        collegeId: idSchema,
        audience: audienceSchema,
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(4000),
        /** notice (default) / holiday / exam / event. */
        kind: noticeKindSchema.optional(),
        /** ISO date; set to place this on the academic calendar. */
        eventDate: eventDateSchema.optional(),
        /** ISO datetime; omitted = live immediately. */
        publishAt: z.string().datetime().optional(),
        /** ISO datetime; omitted = never expires. */
        expiresAt: z.string().datetime().optional(),
      }),
    },
    audit: { action: "notices.created", resourceType: "notice" },
    responses: {
      201: { description: "Created", schema: noticeViewSchema },
      404: { description: "No such college/department/class", schema: problemSchema },
      422: { description: "Expiry precedes publish", schema: problemSchema },
    },
  },
  {
    id: "notices.list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/notices",
    summary: "Every notice of a college incl. scheduled/expired (admin/principal manage view)",
    tags: ["notices"],
    auth: ADMIN_OR_PRINCIPAL,
    request: { query: z.object({ collegeId: idSchema }) },
    responses: {
      200: { description: "Notices", schema: z.object({ notices: z.array(noticeViewSchema) }) },
    },
  },
  {
    id: "notices.visible",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/notices/visible",
    summary: "Live notices the caller may see — audience filtering is server-side",
    description:
      "Staff visibility derives from session grants (org-path overlap); student visibility from the identity link's enrollment. A student in class X sees class-X + college + students notices, never staff ones.",
    tags: ["notices"],
    auth: ANY_AUTHENTICATED,
    responses: {
      200: { description: "Visible notices, newest first", schema: z.object({ notices: z.array(noticeViewSchema) }) },
    },
  },
  {
    id: "notices.delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/notices/{noticeId}",
    summary: "Take a notice off the board (admin/principal)",
    tags: ["notices"],
    auth: ADMIN_OR_PRINCIPAL,
    request: { params: z.object({ noticeId: idSchema }) },
    audit: { action: "notices.deleted", resourceType: "notice" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such notice", schema: problemSchema },
    },
  },
];

export const noticesModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
