import { z } from "zod";
import type { ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "coursework";
export const TABLE_PREFIX = "cwk_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** ~1MB binary as base64 (matches the CSV import cap). */
const base64Schema = z.string().max(1_400_000);

const problemSchema = z.object({ type: z.string(), title: z.string(), status: z.number(), requestId: z.string() });

const TEACHER_ONLY = { public: false as const, requirement: { rolesAnyOf: ["teacher" as const, "class_teacher" as const] } };
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const assignmentViewSchema = z.object({
  id: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  title: z.string(),
  instructions: z.string(),
  dueOn: z.string(),
  maxScore: z.number().nullable(),
  academicYear: z.string(),
  submissions: z.number().optional(),
});

const submissionViewSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  body: z.string(),
  hasFile: z.boolean(),
  submittedAt: z.string(),
  score: z.number().nullable(),
  feedback: z.string().nullable(),
});

const materialViewSchema = z.object({
  id: z.string(),
  classId: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  title: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});

const yearQuery = z.object({ academicYear: academicYearSchema });

const routes: RouteSpec[] = [
  {
    id: "coursework.assignment-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/coursework/assignments",
    summary: "Create an assignment (the subject's teacher)",
    tags: ["coursework"],
    auth: TEACHER_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        subjectId: idSchema,
        title: z.string().trim().min(1).max(160),
        instructions: z.string().max(4000).default(""),
        dueOn: dateSchema,
        maxScore: z.number().positive().max(9999).optional(),
        academicYear: academicYearSchema,
      }),
    },
    audit: { action: "coursework.assignment-created", resourceType: "assignment" },
    responses: {
      201: { description: "Created", schema: assignmentViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such class/subject", schema: problemSchema },
      409: { description: "Duplicate title for subject/year", schema: problemSchema },
      422: { description: "Subject not of the class's department", schema: problemSchema },
    },
  },
  {
    id: "coursework.class-assignments",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/classes/{classId}/assignments",
    summary: "A class's assignments (row-filtered by subject read scope)",
    tags: ["coursework"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ classId: idSchema }), query: yearQuery },
    responses: {
      200: { description: "Assignments", schema: z.object({ assignments: z.array(assignmentViewSchema) }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "coursework.assignment-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/coursework/assignments/{assignmentId}",
    summary: "Delete an assignment without submissions (the subject's teacher)",
    tags: ["coursework"],
    auth: TEACHER_ONLY,
    request: { params: z.object({ assignmentId: idSchema }) },
    audit: { action: "coursework.assignment-deleted", resourceType: "assignment" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such assignment", schema: problemSchema },
      409: { description: "Submissions exist", schema: problemSchema },
    },
  },
  {
    id: "coursework.submissions",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/assignments/{assignmentId}/submissions",
    summary: "An assignment's submissions (the subject's teacher)",
    tags: ["coursework"],
    auth: TEACHER_ONLY,
    request: { params: z.object({ assignmentId: idSchema }) },
    responses: {
      200: { description: "Submissions", schema: z.object({ submissions: z.array(submissionViewSchema) }) },
      403: { description: "Scope denied", schema: problemSchema },
      404: { description: "No such assignment", schema: problemSchema },
    },
  },
  {
    id: "coursework.evaluate",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/coursework/submissions/{submissionId}/evaluate",
    summary: "Score a submission (the subject's teacher; audited)",
    tags: ["coursework"],
    auth: TEACHER_ONLY,
    request: {
      params: z.object({ submissionId: idSchema }),
      body: z.object({ score: z.number().min(0).max(9999), feedback: z.string().max(2000).default("") }),
    },
    audit: { action: "coursework.submission-evaluated", resourceType: "submission" },
    responses: {
      200: { description: "Evaluated", schema: submissionViewSchema },
      404: { description: "No such submission", schema: problemSchema },
      422: { description: "Score exceeds the assignment's maxScore", schema: problemSchema },
    },
  },
  {
    id: "coursework.material-upload",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/coursework/materials",
    summary: "Upload a study material (the subject's teacher; ≤1MB)",
    tags: ["coursework"],
    auth: TEACHER_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        subjectId: idSchema,
        title: z.string().trim().min(1).max(160),
        contentType: z.string().min(3).max(100),
        dataBase64: base64Schema,
        academicYear: academicYearSchema,
      }),
    },
    audit: { action: "coursework.material-uploaded", resourceType: "material" },
    responses: {
      201: { description: "Uploaded", schema: materialViewSchema },
      403: { description: "Not this subject's teacher", schema: problemSchema },
      404: { description: "No such class/subject", schema: problemSchema },
      422: { description: "Subject not of the class's department", schema: problemSchema },
    },
  },
  {
    id: "coursework.class-materials",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/classes/{classId}/materials",
    summary: "A class's materials (staff scope; enrolled students via portal routes)",
    tags: ["coursework"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ classId: idSchema }), query: yearQuery },
    responses: {
      200: { description: "Materials", schema: z.object({ materials: z.array(materialViewSchema) }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "coursework.material-download",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/materials/{materialId}/download",
    summary: "Download a material (staff scope, or an enrolled student of the class)",
    tags: ["coursework"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ materialId: idSchema }) },
    responses: {
      200: { description: "The file bytes" },
      403: { description: "Scope denied", schema: problemSchema },
      404: { description: "No such material", schema: problemSchema },
    },
  },
  // --- student self-scope (identity link; no ids accepted) ---
  {
    id: "coursework.my-assignments",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/my/assignments",
    summary: "The signed-in student's assignments with own submission status",
    tags: ["coursework"],
    auth: STUDENT_ONLY,
    request: { query: yearQuery },
    responses: {
      200: {
        description: "Assignments + own submission state",
        schema: z.object({
          assignments: z.array(
            assignmentViewSchema.extend({
              mySubmission: z
                .object({ submittedAt: z.string(), score: z.number().nullable(), feedback: z.string().nullable() })
                .nullable(),
            }),
          ),
        }),
      },
      404: { description: "Sign-in not linked to a student", schema: problemSchema },
    },
  },
  {
    id: "coursework.submit",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/coursework/my/assignments/{assignmentId}/submission",
    summary: "Submit (or resubmit until evaluated) the signed-in student's work",
    tags: ["coursework"],
    auth: STUDENT_ONLY,
    request: {
      params: z.object({ assignmentId: idSchema }),
      body: z.object({
        body: z.string().max(8000).default(""),
        contentType: z.string().max(100).optional(),
        dataBase64: base64Schema.optional(),
      }),
    },
    audit: { action: "coursework.submitted", resourceType: "submission" },
    responses: {
      200: { description: "Saved", schema: z.object({ ok: z.literal(true), submittedAt: z.string() }) },
      404: { description: "No such assignment / not your class / unlinked", schema: problemSchema },
      409: { description: "Already evaluated — resubmission locked", schema: problemSchema },
    },
  },
  {
    id: "coursework.my-materials",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/coursework/my/materials",
    summary: "The signed-in student's class materials",
    tags: ["coursework"],
    auth: STUDENT_ONLY,
    request: { query: yearQuery },
    responses: {
      200: { description: "Materials", schema: z.object({ materials: z.array(materialViewSchema) }) },
      404: { description: "Sign-in not linked to a student", schema: problemSchema },
    },
  },
];

export const courseworkModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs: [],
};
