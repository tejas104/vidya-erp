import { and, eq } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { sysUserPreferences, type SysUserPreferenceRow } from "../db/schema";

/**
 * The service-layer seam handlers.ts writes through (no direct table access
 * from handlers). Both methods take userId as an explicit argument rather
 * than reading it off a request — the caller (the handler) must supply
 * ctx.principal.id, never a request-supplied value.
 */
export interface PreferencesStore {
  get(userId: string, key: string): Promise<SysUserPreferenceRow | null>;
  set(userId: string, key: string, value: unknown): Promise<SysUserPreferenceRow>;
}

export function createPreferencesStore(db: Db): PreferencesStore {
  return {
    async get(userId, key) {
      const rows = await db
        .select()
        .from(sysUserPreferences)
        .where(and(eq(sysUserPreferences.userId, userId), eq(sysUserPreferences.key, key)))
        .limit(1);
      return rows[0] ?? null;
    },

    async set(userId, key, value) {
      const rows = await db
        .insert(sysUserPreferences)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [sysUserPreferences.userId, sysUserPreferences.key],
          set: { value, updatedAt: new Date() },
        })
        .returning();
      return rows[0]!;
    },
  };
}
