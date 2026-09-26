import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createLogger, migrateDown, migrateUp, migrationStatus } from "@vidya/platform";
import { migrationSources } from "../../scripts/registry";
import { integrationDatabaseUrl } from "./support/db-url";

const logger = createLogger({ level: "silent", serviceName: "vidya-int" });
const pool = new pg.Pool({ connectionString: integrationDatabaseUrl(), max: 3 });
const sources = migrationSources();

afterAll(async () => {
  await pool.end();
});

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [name],
  );
  return (result.rowCount ?? 0) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
    [table, column],
  );
  return (result.rowCount ?? 0) > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
    [name],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Definition text of a named CHECK/UNIQUE/etc constraint on `table`, or null
 *  if it doesn't exist. Used for migrations that DROP+ADD a constraint under
 *  the SAME name (widening/narrowing a CHECK) — existence alone can't prove
 *  the up/down did anything, since the name never changes. */
async function constraintDef(table: string, constraint: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = $1 AND c.conname = $2`,
    [table, constraint],
  );
  return (result.rows[0]?.def as string | undefined) ?? null;
}

/**
 * Per-migration expectations (ADR-0008 forensic follow-up, docs/audit-
 * 2026-08-10-forensic.md item D2): what each migration's *up* introduces,
 * so a rollback+reapply cycle can assert real schema behaviour instead of
 * just "every .sql has a paired .down.sql" (file pairing, not behaviour —
 * the class of bug this misses is a down.sql that runs without error but
 * doesn't actually restore the prior schema, e.g. identity/0002_student_role
 * forgetting to narrow the role CHECK back).
 *
 * One row per migration, table-driven rather than hand-written per-migration
 * test bodies — adding a migration means adding a row here.
 */
interface MigrationExpectation {
  /** Tables the up migration creates (must vanish on down). */
  tables?: string[];
  /** Columns the up migration adds to an existing table (must vanish on down). */
  columns?: { table: string; column: string }[];
  /** Indexes the up migration creates (must vanish on down). */
  indexes?: string[];
  /** A CHECK constraint that up widens/narrows in place (same name before
   *  and after). `addedText` must appear in the definition after up and
   *  must NOT appear after down. */
  constraintDiffs?: { table: string; constraint: string; addedText: string }[];
}

const EXPECTATIONS: Record<string, MigrationExpectation> = {
  "system/0000_audit_log": { tables: ["sys_audit_log"] },
  "system/0001_user_preferences": { tables: ["sys_user_preferences"] },
  "system/0002_clock_watermark": { tables: ["sys_clock_watermark"] },
  "system/0003_audit_scope": {
    columns: [{ table: "sys_audit_log", column: "org" }],
    indexes: ["sys_audit_log_org_id_idx"],
  },
  "system/0004_guardian_actor": {
    constraintDiffs: [
      { table: "sys_audit_log", constraint: "sys_audit_log_actor_type_check", addedText: "guardian" },
    ],
  },
  "system/0005_audit_resource_history": {
    indexes: ["sys_audit_log_resource_history_idx"],
  },

  "identity/0000_identity": {
    tables: ["idn_users", "idn_user_roles", "idn_scope_grants", "idn_reset_tokens"],
  },
  "identity/0001_grant_provenance": {
    columns: [
      { table: "idn_scope_grants", column: "source" },
      { table: "idn_scope_grants", column: "source_ref" },
    ],
    indexes: ["idn_scope_grants_source_ref_idx"],
  },
  "identity/0002_student_role": {
    constraintDiffs: [
      { table: "idn_user_roles", constraint: "idn_user_roles_role_check", addedText: "student" },
    ],
  },
  "identity/0003_accountant_role": {
    constraintDiffs: [
      { table: "idn_user_roles", constraint: "idn_user_roles_role_check", addedText: "accountant" },
    ],
  },
  "identity/0004_accountant_grant_shape": {
    constraintDiffs: [
      {
        table: "idn_scope_grants",
        constraint: "idn_scope_grants_shape_check",
        addedText: "accountant",
      },
    ],
  },
  "identity/0005_guardian_accounts": {
    columns: [{ table: "idn_users", column: "account_kind" }],
  },

  "people/0000_people": {
    tables: [
      "ppl_colleges",
      "ppl_departments",
      "ppl_classes",
      "ppl_sections",
      "ppl_subjects",
      "ppl_students",
      "ppl_teachers",
      "ppl_enrollments",
      "ppl_teacher_assignments",
      "ppl_imports",
    ],
  },
  "people/0001_student_identity_link": {
    columns: [{ table: "ppl_students", column: "identity_user_id" }],
    indexes: ["ppl_students_identity_uq"],
  },
  "people/0002_student_lifecycle": {
    constraintDiffs: [
      { table: "ppl_students", constraint: "ppl_students_status_check", addedText: "backlog" },
    ],
  },
  "people/0003_student_profile": {
    columns: [
      { table: "ppl_students", column: "phone" },
      { table: "ppl_students", column: "guardian_name" },
      { table: "ppl_students", column: "guardian_phone" },
      { table: "ppl_students", column: "dob" },
    ],
  },
  "people/0004_student_documents": { tables: ["ppl_student_documents"] },
  "people/0005_import_warnings": {
    columns: [
      { table: "ppl_imports", column: "warning_rows" },
      { table: "ppl_imports", column: "processed_rows" },
      { table: "ppl_imports", column: "warnings" },
    ],
  },
  "people/0006_guardians": {
    tables: ["ppl_guardians", "ppl_student_guardians", "ppl_guardian_invitations"],
    indexes: ["ppl_guardians_identity_idx", "ppl_sg_pair_idx", "ppl_sg_student_idx", "ppl_gi_code_idx", "ppl_gi_student_idx"],
  },
  // Same index name before and after (non-unique to unique); nothing here can
  // tell the two apart, so the row only records that the rollback runs.
  "people/0007_unique_teacher_identity": {},
  "people/0008_teacher_attendance": {
    tables: ["ppl_teacher_attendance"],
    indexes: ["ppl_teacher_attendance_day_idx", "ppl_teacher_attendance_college_day_idx"],
  },
  "people/0009_enrollment_dates": {
    columns: [{ table: "ppl_enrollments", column: "starts_on" }, { table: "ppl_enrollments", column: "ends_on" }],
    indexes: ["ppl_enrollments_section_year_idx"],
  },
  "people/0010_enrollment_outcomes": {
    columns: [{ table: "ppl_enrollments", column: "outcome" }, { table: "ppl_enrollments", column: "outcome_reason" }],
  },
  "fees/0001_payment_idempotency": {
    columns: [{ table: "fee_payments", column: "idempotency_key" }],
    indexes: ["fee_payments_idempotency_uq"],
  },

  "academics/0000_academics": {
    tables: ["acd_attendance_sessions", "acd_attendance_entries", "acd_assessments", "acd_marks"],
  },
  "academics/0001_attendance_subject": {
    columns: [{ table: "acd_attendance_sessions", column: "subject_id" }],
  },

  "analytics/0000_analytics": {
    tables: ["anl_attendance_rollups", "anl_marks_rollups", "anl_student_flags"],
  },

  "reporting/0000_reporting": { tables: ["rpt_reports"] },
  "reporting/0001_grade_card_kind": {
    constraintDiffs: [
      { table: "rpt_reports", constraint: "rpt_reports_kind_check", addedText: "grade-card" },
    ],
  },
  "reporting/0002_hall_ticket_kind": {
    constraintDiffs: [
      { table: "rpt_reports", constraint: "rpt_reports_kind_check", addedText: "hall-ticket" },
    ],
  },
  "reporting/0003_school_report_cards": {
    tables: ["rpt_school_report_cards"],
    indexes: [
      "rpt_school_report_cards_student_term_idx",
      "rpt_school_report_cards_class_term_idx",
    ],
  },
  "reporting/0004_report_card_publications": {
    tables: ["rpt_school_report_card_publications"],
    indexes: ["rpt_rc_publications_student_term_idx"],
  },
  "reporting/0005_xlsx_format": {
    constraintDiffs: [{ table: "rpt_reports", constraint: "rpt_reports_format_check", addedText: "xlsx" }],
  },
  "reporting/0006_teacher_attendance_kind": {
    constraintDiffs: [{ table: "rpt_reports", constraint: "rpt_reports_kind_check", addedText: "teacher-attendance" }],
  },
  "reporting/0007_school_attendance_review_kind": {
    constraintDiffs: [{ table: "rpt_reports", constraint: "rpt_reports_kind_check", addedText: "school-attendance-review" }],
  },

  "timetable/0000_timetable": { tables: ["ttb_periods", "ttb_entries"] },
  "coursework/0000_coursework": {
    tables: ["cwk_assignments", "cwk_submissions", "cwk_materials"],
  },
  "syllabus/0000_syllabus": { tables: ["syl_units", "syl_topics"] },
  "fees/0000_fees": {
    tables: [
      "fee_heads",
      "fee_structures",
      "fee_invoices",
      "fee_receipt_counters",
      "fee_payments",
      "fee_adjustments",
      "fee_generation_runs",
    ],
  },
  "notices/0000_notices": { tables: ["ntc_notices"] },
  "notices/0001_calendar": {
    columns: [
      { table: "ntc_notices", column: "kind" },
      { table: "ntc_notices", column: "event_date" },
    ],
  },
  "results/0000_results": {
    tables: ["res_grade_scales", "res_subject_credits", "res_publications"],
  },
  "exams/0000_exams": { tables: ["exm_series", "exm_slots"] },
  "leave/0000_leave": { tables: ["lvs_requests"] },
  "school-academics/0000_school_academics": { tables: ["sca_terms"] },
  "school-academics/0001_assessment_types": { tables: ["sca_assessment_types"], indexes: ["sca_assessment_types_term_idx", "sca_assessment_types_name_idx"] },
  "school-academics/0002_school_marks": { tables: ["sca_assessments", "sca_marks"], columns: [{ table: "sca_terms", column: "grade_bands" }, { table: "sca_terms", column: "scale_id" }, { table: "sca_terms", column: "scale_name" }] },
  "school-academics/0003_term_marks_release": { columns: [{ table: "sca_terms", column: "marks_released_at" }] },
  "school-academics/0004_term_calendar": { columns: [{ table: "sca_terms", column: "instructional_days" }, { table: "sca_terms", column: "shortfall_threshold" }, { table: "sca_terms", column: "calendar_version" }] },
};

async function assertPresent(key: string, label: string): Promise<void> {
  const exp = EXPECTATIONS[key];
  if (exp === undefined) return;
  for (const t of exp.tables ?? []) {
    expect(await tableExists(t), `${label}: table ${t} should exist`).toBe(true);
  }
  for (const c of exp.columns ?? []) {
    expect(await columnExists(c.table, c.column), `${label}: column ${c.table}.${c.column} should exist`).toBe(true);
  }
  for (const idx of exp.indexes ?? []) {
    expect(await indexExists(idx), `${label}: index ${idx} should exist`).toBe(true);
  }
  for (const cd of exp.constraintDiffs ?? []) {
    const def = await constraintDef(cd.table, cd.constraint);
    expect(def, `${label}: constraint ${cd.constraint} should exist`).not.toBeNull();
    expect(def!.toLowerCase(), `${label}: constraint ${cd.constraint} should mention "${cd.addedText}"`).toContain(
      cd.addedText.toLowerCase(),
    );
  }
}

async function assertAbsent(key: string, label: string): Promise<void> {
  const exp = EXPECTATIONS[key];
  if (exp === undefined) return;
  for (const t of exp.tables ?? []) {
    expect(await tableExists(t), `${label}: table ${t} should be gone`).toBe(false);
  }
  for (const c of exp.columns ?? []) {
    expect(await columnExists(c.table, c.column), `${label}: column ${c.table}.${c.column} should be gone`).toBe(false);
  }
  for (const idx of exp.indexes ?? []) {
    expect(await indexExists(idx), `${label}: index ${idx} should be gone`).toBe(false);
  }
  for (const cd of exp.constraintDiffs ?? []) {
    const def = await constraintDef(cd.table, cd.constraint);
    // down.sql restores the narrower/pre-change constraint under the same
    // name — it must still exist, just without the text the up migration added.
    expect(def, `${label}: constraint ${cd.constraint} should still exist (down restores the prior version)`).not.toBeNull();
    expect(
      def!.toLowerCase(),
      `${label}: constraint ${cd.constraint} should no longer mention "${cd.addedText}"`,
    ).not.toContain(cd.addedText.toLowerCase());
  }
}

describe("migration harness (ADR-0008)", () => {
  it("reports the system audit migration as applied after global setup", async () => {
    const status = await migrationStatus(pool, sources);
    expect(status.pending).toHaveLength(0);
    expect(status.applied.map((entry) => `${entry.module}/${entry.name}`)).toContain(
      "system/0000_audit_log",
    );
  });

  it("every migration has a behavioural expectation registered (table stays in sync with disk)", async () => {
    const status = await migrationStatus(pool, sources);
    const missing = status.applied
      .map((entry) => `${entry.module}/${entry.name}`)
      .filter((key) => EXPECTATIONS[key] === undefined);
    expect(missing, "add a row to EXPECTATIONS for these migrations").toEqual([]);
  });

  it("each migration's up creates its objects, its down removes them, and reapplying up restores them", async () => {
    const status = await migrationStatus(pool, sources);
    // Applied order == the order migrateUp actually ran them in (journal id
    // order), which is registry order then filename order within a module —
    // the same order migrateDown unwinds from the tail.
    const order = status.applied.map((entry) => ({ module: entry.module, name: entry.name }));
    expect(order.length).toBeGreaterThan(0);

    // Some rollbacks refuse to discard history (Excel and new-kind report
    // rows, recorded enrollment outcomes). Other suites may have written such
    // rows into this disposable database; the walk below drops every table
    // anyway, so clear exactly those rows first.
    await pool.query("DELETE FROM rpt_reports WHERE format = 'xlsx' OR kind IN ('teacher-attendance', 'school-attendance-review')");
    await pool.query("UPDATE ppl_enrollments SET outcome = NULL, outcome_reason = NULL WHERE outcome IS NOT NULL");

    // Walk backward, rolling back exactly one migration at a time (mirrors
    // migrateDown's `steps` semantics: it always unwinds the most-recently-
    // applied migration first). Assert each migration's own objects are
    // present right before its rollback, and gone right after — this is
    // the part a "does the file exist" check can never catch: a down.sql
    // that runs without error but silently fails to undo its up.
    for (let i = order.length - 1; i >= 0; i--) {
      const { module, name } = order[i]!;
      const key = `${module}/${name}`;
      await assertPresent(key, `${key} before its own rollback`);
      const rolledBack = await migrateDown(pool, sources, 1, logger);
      expect(rolledBack.map((entry) => `${entry.module}/${entry.name}`)).toEqual([key]);
      await assertAbsent(key, `${key} after its own rollback`);
    }

    // Every module's tables are gone; only the journal (empty) remains. (The
    // loop above already proved each migration's own down worked, checked at
    // the moment only that migration had been rolled back — a second blanket
    // check here would be meaningless for constraint-diff entries: once an
    // earlier migration like identity/0000 has dropped idn_user_roles
    // entirely, "the narrowed constraint should still exist" no longer makes
    // sense. tableExists is unambiguous at any point, so spot-check with it.)
    for (const exp of Object.values(EXPECTATIONS)) {
      for (const t of exp.tables ?? []) {
        expect(await tableExists(t), `${t} should be gone once the whole schema is rolled back`).toBe(false);
      }
    }

    // Reapply everything from a bare schema (migrateUp has no per-step
    // granularity — unlike migrateDown it always drains the full pending
    // queue — so "up restores it" is verified in one bulk pass with a
    // per-migration presence check against the end state, exercising every
    // up.sql fresh rather than relying on state left over from global setup).
    const reapplied = await migrateUp(pool, sources, logger);
    // A newly added migration can have a later journal id on this already-used
    // local database even though a fresh install runs it with its module. The
    // rollback order above must follow journal order; the reapply assertion is
    // about the same complete migration set, independent of that history.
    expect(reapplied.map((entry) => `${entry.module}/${entry.name}`).sort()).toEqual(
      order.map(({ module, name }) => `${module}/${name}`).sort(),
    );
    for (const { module, name } of reapplied) {
      await assertPresent(`${module}/${name}`, `${module}/${name} after full reapply`);
    }
  });

  it("is idempotent — a second up run applies nothing", async () => {
    const applied = await migrateUp(pool, sources, logger);
    expect(applied).toHaveLength(0);
  });

  it("journals applied migrations in platform_migrations", async () => {
    const result = await pool.query(
      "SELECT module, name FROM platform_migrations ORDER BY id",
    );
    expect(result.rows).toContainEqual({ module: "system", name: "0000_audit_log" });
    expect(result.rows).toContainEqual({ module: "identity", name: "0000_identity" });
  });

  it("survives concurrent runners (advisory lock)", async () => {
    const results = await Promise.all([
      migrateUp(pool, sources, logger),
      migrateUp(pool, sources, logger),
    ]);
    expect(results.flat()).toHaveLength(0);
  });

  it("refuses to roll back when the journal references a missing rollback file", async () => {
    const ghost = `9999_ghost_${randomUUID().slice(0, 8)}`;
    await pool.query("INSERT INTO platform_migrations (module, name) VALUES ($1, $2)", [
      "system",
      ghost,
    ]);
    try {
      await expect(migrateDown(pool, sources, 1, logger)).rejects.toThrow(/missing on disk/);
    } finally {
      await pool.query("DELETE FROM platform_migrations WHERE name = $1", [ghost]);
    }
  });
});
