import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { schTerms, type SchTermRow } from "./db/schema";

export class DuplicateTermError extends Error {
  constructor() {
    super("a term with this name already exists for this school and academic year");
    this.name = "DuplicateTermError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  // drizzle >=0.44 wraps driver errors in DrizzleQueryError; the pg code rides on .cause
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export interface NewTerm {
  readonly collegeId: string;
  readonly departmentId: string;
  readonly name: string;
  readonly academicYear: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface TermsRepo {
  create(input: NewTerm): Promise<SchTermRow>;
  get(id: string): Promise<SchTermRow | null>;
  /** Newest first, across every college the caller holds a grant in. */
  list(collegeIds: readonly string[], academicYear?: string): Promise<SchTermRow[]>;
  /** open <-> closed, stamping who/when/why of THIS transition. */
  setStatus(input: {
    id: string;
    status: "open" | "closed";
    actorId: string;
    reason: string | null;
  }): Promise<SchTermRow | null>;
  /** Explicitly release a previously closed term (e.g. one closed before rollout). */
  releaseMarks(id: string): Promise<SchTermRow | null>;
  setCalendar(input: { id: string; expectedVersion: number; instructionalDays: string[]; shortfallThreshold: number }): Promise<SchTermRow | null>;
}

export function createTermsRepo(db: Db): TermsRepo {
  return {
    async create(input) {
      try {
        const rows = await db
          .insert(schTerms)
          .values({ id: `trm_${randomUUID()}`, ...input })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") {
          throw new DuplicateTermError();
        }
        throw error;
      }
    },

    async get(id) {
      const rows = await db.select().from(schTerms).where(eq(schTerms.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async list(collegeIds, academicYear) {
      if (collegeIds.length === 0) return [];
      const where =
        academicYear === undefined
          ? inArray(schTerms.collegeId, [...collegeIds])
          : and(
              inArray(schTerms.collegeId, [...collegeIds]),
              eq(schTerms.academicYear, academicYear),
            );
      return db.select().from(schTerms).where(where).orderBy(desc(schTerms.createdAt));
    },

    async setStatus(input) {
      const rows = await db
        .update(schTerms)
        .set({
          status: input.status,
          closedAt: new Date(),
          closedBy: input.actorId,
          closedReason: input.reason,
          marksReleasedAt: input.status === "closed" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(schTerms.id, input.id), eq(schTerms.status, input.status === "open" ? "closed" : "open")))
        .returning();
      return rows[0] ?? null;
    },
    async releaseMarks(id) {
      const rows = await db.update(schTerms)
        .set({ marksReleasedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schTerms.id, id), eq(schTerms.status, "closed"), isNull(schTerms.marksReleasedAt)))
        .returning();
      return rows[0] ?? null;
    },
    async setCalendar(input) {
      const rows = await db.update(schTerms)
        .set({ instructionalDays: input.instructionalDays, shortfallThreshold: String(input.shortfallThreshold), calendarVersion: input.expectedVersion + 1, updatedAt: new Date() })
        .where(and(eq(schTerms.id, input.id), eq(schTerms.status, "open"), eq(schTerms.calendarVersion, input.expectedVersion)))
        .returning();
      return rows[0] ?? null;
    },
  };
}
