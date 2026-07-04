import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * INTERNAL to the identity module (not exported from index.ts). All tables
 * carry the "idn_" prefix (Constitution rule 2; CI-checked). Org identifiers
 * (college/department/class/section/subject) are OPAQUE strings under the
 * #3 identifier contract — never foreign keys.
 *
 * Sessions are NOT here: they live in Redis (human-owned SessionManager).
 */

export const idnUsers = pgTable(
  "idn_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().default("must_reset"),
    collegeId: text("college_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idn_users_username_idx").on(table.username)],
);

export const idnUserRoles = pgTable(
  "idn_user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => idnUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const idnScopeGrants = pgTable(
  "idn_scope_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    collegeId: text("college_id").notNull(),
    departmentId: text("department_id"),
    classId: text("class_id"),
    sectionId: text("section_id"),
    subjectId: text("subject_id"),
    /** False until module #3's OrgDirectory verifies the identifiers. */
    verified: boolean("verified").notNull().default(false),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idn_scope_grants_user_idx").on(table.userId)],
);

export const idnResetTokens = pgTable(
  "idn_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => idnUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idn_reset_tokens_hash_idx").on(table.tokenHash),
    index("idn_reset_tokens_expires_idx").on(table.expiresAt),
  ],
);

export type IdnUserRow = typeof idnUsers.$inferSelect;
export type IdnScopeGrantRow = typeof idnScopeGrants.$inferSelect;
