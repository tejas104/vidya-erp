import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "people";
export const TABLE_PREFIX = "ppl_";

// ---------------------------------------------------------------------------
// Shared schemas (OpenAPI source, ADR-0007)
// ---------------------------------------------------------------------------

export const idSchema = z.string().min(1).max(64);
export const codeSchema = z.string().trim().min(1).max(32);
export const nameSchema = z.string().trim().min(1).max(128);
export const academicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');

export const orgUnitTypeSchema = z.enum(["college", "department", "class", "section", "subject"]);

const collegeViewSchema = z.object({ id: z.string(), name: z.string(), code: z.string() });
const departmentViewSchema = collegeViewSchema.extend({ collegeId: z.string() });
const classViewSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  name: z.string(),
  code: z.string(),
});
const sectionViewSchema = z.object({ id: z.string(), classId: z.string(), name: z.string() });
const subjectViewSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  name: z.string(),
  code: z.string(),
});

const treeSchema = z.object({
  college: collegeViewSchema,
  departments: z.array(
    departmentViewSchema.extend({
      classes: z.array(classViewSchema.extend({ sections: z.array(sectionViewSchema) })),
      subjects: z.array(subjectViewSchema),
    }),
  ),
});

/**
 * A student is a lifecycle, not a row — the record is never destroyed, only
 * moved through these states (ADR-0013 retention; SPPU ATKT ordinances):
 *   active · backlog (ATKT) · year_back (detained) · transferred (TC) ·
 *   dropped · alumni. "inactive" is kept for records seeded before the
 *   lifecycle existed.
 */
export const studentStatusSchema = z.enum([
  "active",
  "inactive",
  "backlog",
  "year_back",
  "transferred",
  "dropped",
  "alumni",
]);

/** Profile depth (2.5): optional personal + guardian contact. */
export const phoneSchema = z.string().trim().min(3).max(20);
export const dobSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");
export const studentProfilePatchSchema = z.object({
  phone: phoneSchema.nullable().optional(),
  guardianName: z.string().trim().min(1).max(120).nullable().optional(),
  guardianPhone: phoneSchema.nullable().optional(),
  dob: dobSchema.nullable().optional(),
});

export const studentViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  admissionNo: z.string(),
  fullName: z.string(),
  status: studentStatusSchema,
  identityUserId: z.string().nullable(),
  phone: z.string().nullable(),
  guardianName: z.string().nullable(),
  guardianPhone: z.string().nullable(),
  dob: z.string().nullable(),
  enrollment: z
    .object({
      sectionId: z.string(),
      academicYear: z.string(),
    })
    .nullable(),
});

export const teacherViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  staffNo: z.string(),
  fullName: z.string(),
  status: z.enum(["active", "inactive"]),
  identityUserId: z.string().nullable(),
});

export const assignmentViewSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  classId: z.string(),
  subjectId: z.string().nullable(),
  kind: z.enum(["subject_teacher", "class_teacher"]),
  academicYear: z.string(),
});

export const importViewSchema = z.object({
  id: z.string(),
  kind: z.enum(["students", "teachers"]),
  collegeId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  dryRun: z.boolean(),
  totalRows: z.number(),
  okRows: z.number(),
  errorRows: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
});

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const ADMIN_OR_CLASS_TEACHER = {
  public: false as const,
  requirement: { rolesAnyOf: ["admin" as const, "class_teacher" as const] },
};
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

// ---------------------------------------------------------------------------
// Routes — every one auth-required; record-level access is the ScopeChecker.
// ---------------------------------------------------------------------------

const routes: RouteSpec[] = [
  {
    id: "people.college-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/colleges",
    summary: "List colleges the caller can read",
    tags: ["people-org"],
    auth: ANY_AUTHENTICATED,
    responses: { 200: { description: "Readable colleges", schema: z.object({ colleges: z.array(collegeViewSchema) }) } },
  },
  {
    id: "people.college-tree",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/colleges/{collegeId}/tree",
    summary: "The full org tree of a college",
    tags: ["people-org"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ collegeId: idSchema }) },
    responses: {
      200: { description: "College tree", schema: treeSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such college", schema: problemSchema },
    },
  },
  {
    id: "people.department-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/departments",
    summary: "Create a department (admin)",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ collegeId: idSchema, name: nameSchema, code: codeSchema }) },
    audit: { action: "people.department-created", resourceType: "department" },
    responses: {
      201: { description: "Created", schema: departmentViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "Duplicate code", schema: problemSchema },
    },
  },
  {
    id: "people.class-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/classes",
    summary: "Create a class under a department (admin)",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ departmentId: idSchema, name: nameSchema, code: codeSchema }) },
    audit: { action: "people.class-created", resourceType: "class" },
    responses: {
      201: { description: "Created", schema: classViewSchema },
      404: { description: "No such department", schema: problemSchema },
      409: { description: "Duplicate code", schema: problemSchema },
    },
  },
  {
    id: "people.section-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/sections",
    summary: "Create a section under a class (admin)",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ classId: idSchema, name: nameSchema }) },
    audit: { action: "people.section-created", resourceType: "section" },
    responses: {
      201: { description: "Created", schema: sectionViewSchema },
      404: { description: "No such class", schema: problemSchema },
      409: { description: "Duplicate name", schema: problemSchema },
    },
  },
  {
    id: "people.subject-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/subjects",
    summary: "Create a subject under a department (admin)",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ departmentId: idSchema, name: nameSchema, code: codeSchema }) },
    audit: { action: "people.subject-created", resourceType: "subject" },
    responses: {
      201: { description: "Created", schema: subjectViewSchema },
      404: { description: "No such department", schema: problemSchema },
      409: { description: "Duplicate code", schema: problemSchema },
    },
  },
  {
    id: "people.org-rename",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/people/org/{unitType}/{unitId}",
    summary: "Rename an org unit (admin)",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ unitType: orgUnitTypeSchema, unitId: idSchema }),
      body: z.object({ name: nameSchema }),
    },
    audit: { action: "people.org-unit-renamed", resourceType: "org-unit" },
    responses: {
      200: { description: "Renamed", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such unit", schema: problemSchema },
    },
  },
  {
    id: "people.org-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/people/org/{unitType}/{unitId}",
    summary: "Delete an empty org unit (admin)",
    description: "Deletion is RESTRICT: units with children or references answer 409.",
    tags: ["people-org"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ unitType: orgUnitTypeSchema, unitId: idSchema }) },
    audit: { action: "people.org-unit-deleted", resourceType: "org-unit" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such unit", schema: problemSchema },
      409: { description: "Unit still referenced", schema: problemSchema },
    },
  },
  {
    id: "people.student-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/students",
    summary: "Create a student (admin college-wide; class teacher into their own section)",
    description:
      "Admin creates a college-anchored student. A class teacher passes sectionId to add a student straight into THEIR section (create + enroll, scope-checked against that section — 403 for any other). Records are never hard-deleted.",
    tags: ["people-students"],
    auth: ADMIN_OR_CLASS_TEACHER,
    request: {
      body: z.object({
        collegeId: idSchema,
        admissionNo: codeSchema,
        fullName: nameSchema,
        /** When present, the student is enrolled here on creation (class-teacher add). */
        sectionId: idSchema.optional(),
        academicYear: academicYearSchema.optional(),
      }),
    },
    audit: { action: "people.student-created", resourceType: "student" },
    responses: {
      201: { description: "Created", schema: studentViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "Duplicate admission number", schema: problemSchema },
    },
  },
  {
    id: "people.student-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/students/{studentId}",
    summary: "Read a student (scope-checked at the student's org position)",
    tags: ["people-students"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ studentId: idSchema }) },
    responses: {
      200: { description: "The student", schema: studentViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "people.student-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/people/students/{studentId}",
    summary: "Update a student — rename, edit contact, or move the lifecycle (admin; class teacher for their own section)",
    description:
      "The class teacher is a scoped sub-admin: they may edit and change the status of students in THEIR section only (the ScopeChecker enforces the section — 403 for any other). Status transitions are audited and the record is never destroyed (TC / marksheet / audit retention).",
    tags: ["people-students"],
    auth: ADMIN_OR_CLASS_TEACHER,
    request: {
      params: z.object({ studentId: idSchema }),
      body: z
        .object({ fullName: nameSchema.optional(), status: studentStatusSchema.optional() })
        .merge(studentProfilePatchSchema)
        .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
          message: "at least one field required",
        }),
    },
    audit: { action: "people.student-updated", resourceType: "student" },
    responses: {
      200: { description: "Updated", schema: studentViewSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "people.student-enroll",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/students/{studentId}/enrollment",
    summary: "Enroll or transfer a student into a section",
    description:
      "Withdraws the year's live enrollment (if any) and creates the new one. Admin college-wide; class_teacher within their class per the matrix's promotion clause — the scope check runs against BOTH the source and the target section.",
    tags: ["people-students"],
    auth: ADMIN_OR_CLASS_TEACHER,
    request: {
      params: z.object({ studentId: idSchema }),
      body: z.object({ sectionId: idSchema, academicYear: academicYearSchema }),
    },
    audit: { action: "people.student-enrolled", resourceType: "enrollment" },
    responses: {
      200: {
        description: "Enrolled",
        schema: z.object({
          enrollmentId: z.string(),
          previousEnrollmentId: z.string().nullable(),
        }),
      },
      403: { description: "Scope check denied (source or target)", schema: problemSchema },
      404: { description: "No such student or section", schema: problemSchema },
    },
  },
  {
    id: "people.student-link-identity",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/students/{studentId}/identity-link",
    summary: "Link (or unlink) the student to an identity sign-in (admin)",
    description:
      "W1 student portal: the link is the student's ONLY access authority — students hold no scope grants. One sign-in per student (unique).",
    tags: ["people-students"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ studentId: idSchema }),
      body: z.object({ identityUserId: idSchema.nullable() }),
    },
    audit: { action: "people.student-identity-linked", resourceType: "student" },
    responses: {
      200: { description: "Link updated", schema: z.object({ student: studentViewSchema }) },
      404: { description: "No such student", schema: problemSchema },
      409: { description: "That sign-in is already linked to another student", schema: problemSchema },
    },
  },
  {
    id: "people.section-roster",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/sections/{sectionId}/roster",
    summary: "The live roster of a section",
    tags: ["people-students"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ sectionId: idSchema }) },
    responses: {
      200: { description: "Enrolled students", schema: z.object({ students: z.array(studentViewSchema) }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such section", schema: problemSchema },
    },
  },
  {
    id: "people.teacher-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/teachers",
    summary: "Create a teacher record (admin)",
    tags: ["people-teachers"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ collegeId: idSchema, staffNo: codeSchema, fullName: nameSchema }) },
    audit: { action: "people.teacher-created", resourceType: "teacher" },
    responses: {
      201: { description: "Created", schema: teacherViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "Duplicate staff number", schema: problemSchema },
    },
  },
  {
    id: "people.teacher-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/teachers/{teacherId}",
    summary: "Read a teacher (self-access via the identity link, else scope)",
    tags: ["people-teachers"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ teacherId: idSchema }) },
    responses: {
      200: { description: "The teacher", schema: teacherViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such teacher", schema: problemSchema },
    },
  },
  {
    id: "people.teacher-update",
    module: MODULE_NAME,
    method: "PATCH",
    path: "/api/v1/people/teachers/{teacherId}",
    summary: "Update a teacher (admin)",
    description: "Setting status=inactive removes the teacher's derived grants (ADR-0015).",
    tags: ["people-teachers"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ teacherId: idSchema }),
      body: z
        .object({ fullName: nameSchema.optional(), status: z.enum(["active", "inactive"]).optional() })
        .refine((patch) => patch.fullName !== undefined || patch.status !== undefined, {
          message: "at least one field required",
        }),
    },
    audit: { action: "people.teacher-updated", resourceType: "teacher" },
    responses: {
      200: { description: "Updated", schema: teacherViewSchema },
      404: { description: "No such teacher", schema: problemSchema },
    },
  },
  {
    id: "people.teacher-link-identity",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/teachers/{teacherId}/identity-link",
    summary: "Link (or unlink) the teacher to an identity user (admin)",
    description:
      "Linking derives grants for the teacher's existing assignments; unlinking removes them (ADR-0015).",
    tags: ["people-teachers"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ teacherId: idSchema }),
      body: z.object({ identityUserId: idSchema.nullable() }),
    },
    audit: { action: "people.teacher-identity-linked", resourceType: "teacher" },
    responses: {
      200: {
        description: "Link updated; grant sync counts included",
        schema: z.object({
          teacher: teacherViewSchema,
          grants: z.object({ upserted: z.number(), removed: z.number() }),
        }),
      },
      404: { description: "No such teacher", schema: problemSchema },
    },
  },
  {
    id: "people.assignment-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/teachers/{teacherId}/assignments",
    summary: "Assign a teacher to a class (admin) — derives the identity grant",
    description:
      "subject_teacher requires subjectId; class_teacher forbids it. The derived grant is class-level per the approved policy; failure to derive rolls the assignment back.",
    tags: ["people-assignments"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ teacherId: idSchema }),
      body: z
        .object({
          classId: idSchema,
          subjectId: idSchema.optional(),
          kind: z.enum(["subject_teacher", "class_teacher"]),
          academicYear: academicYearSchema,
        })
        .superRefine((body, ctx) => {
          if (body.kind === "subject_teacher" && body.subjectId === undefined) {
            ctx.addIssue({ code: "custom", path: ["subjectId"], message: "subject_teacher requires subjectId" });
          }
          if (body.kind === "class_teacher" && body.subjectId !== undefined) {
            ctx.addIssue({ code: "custom", path: ["subjectId"], message: "class_teacher must not carry a subject" });
          }
        }),
    },
    audit: { action: "people.assignment-created", resourceType: "teacher-assignment" },
    responses: {
      201: { description: "Assignment created (grant derived when the teacher is linked)", schema: assignmentViewSchema },
      404: { description: "No such teacher/class/subject", schema: problemSchema },
      409: { description: "Equivalent assignment already exists", schema: problemSchema },
    },
  },
  {
    id: "people.assignment-remove",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/people/assignments/{assignmentId}",
    summary: "Remove an assignment (admin) — removes the derived grant first",
    tags: ["people-assignments"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ assignmentId: idSchema }) },
    audit: { action: "people.assignment-removed", resourceType: "teacher-assignment" },
    responses: {
      200: { description: "Removed", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such assignment", schema: problemSchema },
    },
  },
  {
    id: "people.class-assignments",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/classes/{classId}/assignments",
    summary: "List a class's teacher assignments",
    tags: ["people-assignments"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ classId: idSchema }) },
    responses: {
      200: { description: "Assignments", schema: z.object({ assignments: z.array(assignmentViewSchema) }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "people.import-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/imports",
    summary: "Start a bulk CSV import of students or teachers (admin)",
    description:
      "CSV only (export from Excel). Students: admission_no, full_name and optionally department_code+class_code+section_name (requires academicYear). Teachers: staff_no, full_name. Runs in the worker; poll GET /imports/{id}. dryRun validates and reports without writing.",
    tags: ["people-imports"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        kind: z.enum(["students", "teachers"]),
        collegeId: idSchema,
        academicYear: academicYearSchema.optional(),
        dryRun: z.boolean().default(false),
        csv: z.string().min(1).max(1_000_000),
      }),
    },
    audit: { action: "people.import-requested", resourceType: "import" },
    responses: {
      202: { description: "Import accepted and enqueued", schema: z.object({ importId: z.string() }) },
      404: { description: "No such college", schema: problemSchema },
    },
  },
  {
    id: "people.import-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/imports/{importId}",
    summary: "Import status, counts and per-row errors (admin)",
    tags: ["people-imports"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ importId: idSchema }) },
    responses: {
      200: { description: "Import state", schema: importViewSchema },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such import", schema: problemSchema },
    },
  },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const IMPORT_JOB_NAME = "bulk-import";
export const importJobPayloadSchema = z.object({
  importId: idSchema,
  source: z.string().min(1),
});

export const RECONCILE_JOB_NAME = "grant-reconcile";
export const RECONCILE_SCHEDULER_ID = "people-grant-reconcile";
export const reconcileJobPayloadSchema = z.object({
  source: z.string().min(1),
});

const jobs: JobSpec[] = [
  {
    name: IMPORT_JOB_NAME,
    module: MODULE_NAME,
    summary: "Parses, validates and applies a bulk CSV import (or dry-run reports it).",
    payloadSchema: importJobPayloadSchema,
  },
  {
    name: RECONCILE_JOB_NAME,
    module: MODULE_NAME,
    summary:
      "Reconciles derived identity grants against teacher assignments (the ADR-0015 safety net); repairs are audited.",
    payloadSchema: reconcileJobPayloadSchema,
  },
];

export const peopleModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};
