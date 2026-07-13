import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "results";
export const TABLE_PREFIX = "res_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
export const termSchema = z.string().trim().min(1).max(32);

/** One band: percents in [minPct, next band's minPct) earn this grade. */
export const gradeBandSchema = z.object({
  minPct: z.number().min(0).max(100),
  grade: z.string().trim().min(1).max(8),
  points: z.number().min(0).max(10),
});

/**
 * Bands must tile 0–100 with no gaps or overlaps: distinct minPct values and
 * exactly one band anchored at 0 guarantee both (each band runs to the next
 * higher minPct; the highest runs to 100).
 */
export const bandsSchema = z
  .array(gradeBandSchema)
  .min(1)
  .max(16)
  .refine(
    (bands) => new Set(bands.map((b) => b.minPct)).size === bands.length,
    "two bands share a minimum — bands may not overlap",
  )
  .refine((bands) => bands.some((b) => b.minPct === 0), "bands must cover 0–100: one band must start at 0");

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const ADMIN_OR_PRINCIPAL = {
  public: false as const,
  requirement: { rolesAnyOf: ["admin" as const, "principal" as const] },
};
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };

export const gradeScaleViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  name: z.string(),
  bands: z.array(gradeBandSchema),
  /** A scale referenced by a publication is frozen (no update/delete). */
  locked: z.boolean(),
});

export const subjectCreditViewSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  credits: z.number(),
});

export const subjectResultSchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  credits: z.number(),
  /** Mean of the subject's assessment percents, 2dp. */
  pct: z.number(),
  grade: z.string(),
  points: z.number(),
});

export const studentResultSchema = z.object({
  studentId: z.string(),
  studentName: z.string(),
  admissionNo: z.string(),
  subjects: z.array(subjectResultSchema),
  sgpa: z.number(),
  rank: z.number(),
});

export const publicationViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  classId: z.string(),
  academicYear: z.string(),
  term: z.string(),
  scaleId: z.string(),
  publishedAt: z.string(),
  publishedBy: z.string(),
});

const routes: RouteSpec[] = [
  {
    id: "results.scale-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/results/scales",
    summary: "Create a grade scale (admin) — banded points, e.g. 90→A+/10",
    tags: ["results"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        collegeId: idSchema,
        name: z.string().trim().min(1).max(64),
        bands: bandsSchema,
      }),
    },
    audit: { action: "results.scale-created", resourceType: "grade-scale" },
    responses: {
      201: { description: "Created", schema: gradeScaleViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "Duplicate scale name", schema: problemSchema },
    },
  },
  {
    id: "results.scale-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/results/scales",
    summary: "List a college's grade scales",
    tags: ["results"],
    auth: ADMIN_OR_PRINCIPAL,
    request: { query: z.object({ collegeId: idSchema }) },
    responses: {
      200: { description: "Scales", schema: z.object({ scales: z.array(gradeScaleViewSchema) }) },
    },
  },
  {
    id: "results.scale-update",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/results/scales/{scaleId}",
    summary: "Rename a scale or replace its bands (admin)",
    description: "Scales referenced by a publication are frozen — published SGPA must stay reproducible. Create a new scale instead (409).",
    tags: ["results"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ scaleId: idSchema }),
      body: z.object({
        name: z.string().trim().min(1).max(64).optional(),
        bands: bandsSchema.optional(),
      }),
    },
    audit: { action: "results.scale-updated", resourceType: "grade-scale" },
    responses: {
      200: { description: "Updated", schema: gradeScaleViewSchema },
      404: { description: "No such scale", schema: problemSchema },
      409: { description: "Scale is referenced by a publication (frozen), or duplicate name", schema: problemSchema },
    },
  },
  {
    id: "results.scale-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/results/scales/{scaleId}",
    summary: "Delete a grade scale (admin)",
    description: "RESTRICT: scales referenced by a publication answer 409.",
    tags: ["results"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ scaleId: idSchema }) },
    audit: { action: "results.scale-deleted", resourceType: "grade-scale" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such scale", schema: problemSchema },
      409: { description: "Scale is referenced by a publication", schema: problemSchema },
    },
  },
  {
    id: "results.credits-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/results/classes/{classId}/credits",
    summary: "A class's subject credits for a year (set rows only)",
    tags: ["results"],
    auth: ADMIN_OR_PRINCIPAL,
    request: { params: z.object({ classId: idSchema }), query: z.object({ academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Credits", schema: z.object({ credits: z.array(subjectCreditViewSchema) }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "results.credits-set",
    module: MODULE_NAME,
    method: "PUT",
    path: "/api/v1/results/credits",
    summary: "Replace a class's subject credits for a year (admin) — one save for the whole grid",
    tags: ["results"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        academicYear: academicYearSchema,
        entries: z
          .array(z.object({ subjectId: idSchema, credits: z.number().int().min(1).max(10) }))
          .min(1)
          .max(64),
      }),
    },
    audit: { action: "results.credits-set", resourceType: "subject-credits" },
    responses: {
      200: { description: "Saved", schema: z.object({ credits: z.array(subjectCreditViewSchema) }) },
      404: { description: "No such class or subject", schema: problemSchema },
    },
  },
  {
    id: "results.class-results",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/results/classes/{classId}/preview",
    summary: "Compile a class's results live (admin/principal) — marks read model × credits × scale",
    description:
      "Computes SGPA per student from the year's marks: per subject, the mean assessment percent is banded by the scale; SGPA = Σ(points×credits)/Σcredits. Nothing is stored — publishing (results.publish) is what makes a term visible to students.",
    tags: ["results"],
    auth: ADMIN_OR_PRINCIPAL,
    request: {
      params: z.object({ classId: idSchema }),
      query: z.object({ academicYear: academicYearSchema, scaleId: idSchema }),
    },
    responses: {
      200: {
        description: "Computed results, ranked by SGPA",
        schema: z.object({
          rows: z.array(studentResultSchema),
          publications: z.array(publicationViewSchema),
        }),
      },
      404: { description: "No such class or scale", schema: problemSchema },
      422: { description: "No credits set for this class/year — set credits first", schema: problemSchema },
    },
  },
  {
    id: "results.publish",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/results/publish",
    summary: "Publish a term's results (principal/admin, audited) — students see them immediately",
    tags: ["results"],
    auth: ADMIN_OR_PRINCIPAL,
    request: {
      body: z.object({
        classId: idSchema,
        academicYear: academicYearSchema,
        term: termSchema,
        scaleId: idSchema,
      }),
    },
    audit: { action: "results.published", resourceType: "results-publication" },
    responses: {
      201: { description: "Published", schema: publicationViewSchema },
      404: { description: "No such class or scale", schema: problemSchema },
      409: { description: "This class/year/term is already published", schema: problemSchema },
      422: { description: "No credits set for this class/year — set credits first", schema: problemSchema },
    },
  },
  {
    id: "results.my-results",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/results/my-results",
    summary: "The signed-in student's published results (self via the identity link)",
    description: "The publication gate: only published terms appear. An unpublished term is absent — the portal renders the withheld state.",
    tags: ["results"],
    auth: STUDENT_ONLY,
    responses: {
      200: {
        description: "Published terms, newest first, with CGPA across them",
        schema: z.object({
          terms: z.array(
            z.object({
              term: z.string(),
              academicYear: z.string(),
              publishedAt: z.string(),
              sgpa: z.number(),
              subjects: z.array(subjectResultSchema),
            }),
          ),
          cgpa: z.number().nullable(),
        }),
      },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
];

export const resultsModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
