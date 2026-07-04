import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { idnResetTokens } from "../db/schema";

export interface ResetTokensRepo {
  create(entry: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
  }): Promise<void>;
  /** A token is valid when unused and unexpired. */
  findValidByHash(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null>;
  markUsed(id: string, now: Date): Promise<void>;
  /** Removes expired and used tokens; returns the count removed. */
  deleteStale(now: Date): Promise<number>;
}

export function createResetTokensRepo(db: Db): ResetTokensRepo {
  return {
    async create(entry) {
      await db.insert(idnResetTokens).values({
        id: randomUUID(),
        userId: entry.userId,
        tokenHash: entry.tokenHash,
        expiresAt: entry.expiresAt,
        createdBy: entry.createdBy,
      });
    },

    async findValidByHash(tokenHash, now) {
      const rows = await db
        .select({ id: idnResetTokens.id, userId: idnResetTokens.userId })
        .from(idnResetTokens)
        .where(
          and(
            eq(idnResetTokens.tokenHash, tokenHash),
            isNull(idnResetTokens.usedAt),
            sql`${idnResetTokens.expiresAt} > ${now}`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async markUsed(id, now) {
      await db.update(idnResetTokens).set({ usedAt: now }).where(eq(idnResetTokens.id, id));
    },

    async deleteStale(now) {
      const rows = await db
        .delete(idnResetTokens)
        .where(or(lt(idnResetTokens.expiresAt, now), isNotNull(idnResetTokens.usedAt)))
        .returning({ id: idnResetTokens.id });
      return rows.length;
    },
  };
}
