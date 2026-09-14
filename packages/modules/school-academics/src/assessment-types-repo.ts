import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { assessments, assessmentTypes, schTerms } from "./db/schema";
import { AssessmentConfigurationError, assessmentTypesInputSchema, type AssessmentTypeInput, type AssessmentTypeView } from "./assessment-types";

export interface AssessmentTypesRepo {
  list(termId: string): Promise<AssessmentTypeView[]>;
  replace(termId: string, types: AssessmentTypeInput[]): Promise<{ before: AssessmentTypeView[]; types: AssessmentTypeView[] }>;
}

export function createAssessmentTypesRepo(db: Db): AssessmentTypesRepo {
  return {
    list: (termId) => db.select().from(assessmentTypes).where(eq(assessmentTypes.termId, termId)).orderBy(asc(assessmentTypes.name)),
    async replace(termId, input) {
      const validated = assessmentTypesInputSchema.parse({ types: input });
      return db.transaction(async (tx) => {
        // Serializes with term close/reopen (UPDATE takes the same row lock).
        const [term] = await tx.select().from(schTerms).where(eq(schTerms.id, termId)).for("update");
        if (!term || term.status !== "open") throw new AssessmentConfigurationError("Reopen the term before changing assessment types.");
        if ((await tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.termId, termId)).limit(1)).length > 0) throw new AssessmentConfigurationError("This term's assessment types are already in use and cannot be changed.");
        const before = await tx.select().from(assessmentTypes).where(eq(assessmentTypes.termId, termId));
        if (validated.types.some((type) => type.id && !before.some((stored) => stored.id === type.id))) {
          throw new AssessmentConfigurationError("The assessment configuration has changed. Reload it before saving.");
        }
        const types = validated.types.map((type) => ({ ...type, termId, id: type.id ?? `sat_${randomUUID()}` }));
        // Keep stable identifiers on retained types. The replacement is one
        // transaction, including the deferred total-weight constraint.
        await tx.delete(assessmentTypes).where(eq(assessmentTypes.termId, termId));
        await tx.insert(assessmentTypes).values(types);
        return { before, types };
      });
    },
  };
}
