import { z } from "zod";

export const assessmentTypeInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  weight: z.number().int().min(1).max(100),
});

/** Save the complete distribution so intermediate totals never reach storage. */
export const assessmentTypesInputSchema = z.object({
  types: z.array(assessmentTypeInputSchema).min(1).max(20),
}).superRefine(({ types }, ctx) => {
  if (types.reduce((sum, type) => sum + type.weight, 0) !== 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["types"], message: "Assessment weights must total 100%." });
  }
  if (new Set(types.map((type) => type.name.toLowerCase())).size !== types.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["types"], message: "Assessment type names must be unique." });
  }
  const ids = types.flatMap((type) => type.id ? [type.id] : []);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["types"], message: "An assessment type may only appear once." });
  }
});

export type AssessmentTypeInput = z.infer<typeof assessmentTypeInputSchema>;

export const assessmentTypeViewSchema = z.object({
  id: z.string(), termId: z.string(), name: z.string(), weight: z.number(),
});

export type AssessmentTypeView = z.infer<typeof assessmentTypeViewSchema>;

export class AssessmentConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "AssessmentConfigurationError"; }
}
