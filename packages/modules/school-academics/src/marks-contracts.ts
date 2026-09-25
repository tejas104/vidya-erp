import { z } from "zod";
import type { RouteSpec } from "@vidya/platform";
import type { Band } from "@vidya/module-results";

export interface SchoolGradeScales {
  getScale(id: string): Promise<{ id: string; collegeId: string; name: string; bands: Band[] } | null>;
  listScales(collegeId: string): Promise<{ id: string; collegeId: string; name: string; bands: Band[] }[]>;
}

const id = z.string().min(1).max(64);
const score = z.number().finite().min(0).max(9999.99).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places.");
export const newSchoolAssessmentSchema = z.object({
  classId: id, subjectId: id, termId: id, typeId: id, scaleId: id,
  name: z.string().trim().min(1).max(120),
  maxScore: score.refine((value) => value > 0, "Maximum score must be greater than zero."),
  heldOn: z.string().date(),
});
export const schoolMarksInputSchema = z.object({
  // Imports include the score seen at preview time. The repo compares it
  // inside the term-locked transaction before applying any row.
  entries: z.array(z.object({ studentId: id, score, expectedScore: score.nullable().optional() })).min(1).max(500),
}).refine(({ entries }) => new Set(entries.map((entry) => entry.studentId)).size === entries.length, "Each student may appear only once.");

export const schoolAssessmentViewSchema = z.object({
  id, termId: id, typeId: id, classId: id, subjectId: id, name: z.string(), academicYear: z.string(), maxScore: z.number(), heldOn: z.string(),
});
export const schoolMarkViewSchema = z.object({
  id, assessmentId: id, studentId: id, score: z.number(), percentage: z.number(), grade: z.string(), points: z.number(), recordedBy: id, updatedAt: z.string(),
});
const setupTermSchema = z.object({
  id, name: z.string(), academicYear: z.string(), startsOn: z.string(), endsOn: z.string(), status: z.enum(["open", "closed"]),
  scaleId: id.nullable(), scaleName: z.string().nullable(),
  types: z.array(z.object({ id, name: z.string(), weight: z.number() })),
});
const auth = { public: false as const, requirement: {} };
const problem = z.object({ message: z.string() });
const errors = { 403: { description: "Outside scope", schema: problem }, 404: { description: "Not found", schema: problem }, 409: { description: "Term closed or conflicting assessment", schema: problem }, 422: { description: "Invalid academic relationship or marks", schema: problem } };

export const schoolMarksRoutes: RouteSpec[] = [
  { id: "school-academics.class-setup", module: "school-academics", method: "GET", path: "/api/v1/school/classes/{classId}/setup", summary: "Terms, assessment types and grade scales for an authorized school class", tags: ["school-academics"], auth,
    request: { params: z.object({ classId: id }), query: z.object({ academicYear: z.string().min(1).max(32) }) },
    responses: { 200: { description: "Class assessment setup", schema: z.object({ terms: z.array(setupTermSchema), scales: z.array(z.object({ id, name: z.string() })) }) }, ...errors } },
  { id: "school-academics.assessments-list", module: "school-academics", method: "GET", path: "/api/v1/school/classes/{classId}/assessments", summary: "School assessments visible to the caller's subject scope", tags: ["school-academics"], auth,
    request: { params: z.object({ classId: id }), query: z.object({ academicYear: z.string().min(1).max(32) }) },
    responses: { 200: { description: "Assessments", schema: z.object({ assessments: z.array(schoolAssessmentViewSchema) }) }, ...errors } },
  { id: "school-academics.assessment-create", module: "school-academics", method: "POST", path: "/api/v1/school/assessments", summary: "Create a term-linked school assessment for the caller's teaching subject", tags: ["school-academics"], auth,
    request: { body: newSchoolAssessmentSchema }, audit: { action: "school-academics.assessment-created", resourceType: "assessment" },
    responses: { 201: { description: "Created", schema: schoolAssessmentViewSchema }, ...errors } },
  { id: "school-academics.marks-list", module: "school-academics", method: "GET", path: "/api/v1/school/assessments/{assessmentId}/marks", summary: "Read stored school marks and grades", tags: ["school-academics"], auth,
    request: { params: z.object({ assessmentId: id }) }, responses: { 200: { description: "Marks", schema: z.object({ marks: z.array(schoolMarkViewSchema), termStatus: z.enum(["open", "closed"]) }) }, ...errors } },
  { id: "school-academics.marks-enter", module: "school-academics", method: "PUT", path: "/api/v1/school/assessments/{assessmentId}/marks", summary: "Store scores and derived grades atomically; closed terms reject writes", tags: ["school-academics"], auth,
    request: { params: z.object({ assessmentId: id }), body: schoolMarksInputSchema }, audit: { action: "school-academics.marks-entered", resourceType: "assessment" },
    responses: { 200: { description: "Saved", schema: z.object({ marks: z.array(schoolMarkViewSchema) }) }, ...errors } },
];
