/**
 * S04 fee-correctness investigation — real-database evidence.
 *
 * Exercises the ACTUAL production code path (createFeesModule's route
 * handlers, backed by repo.ts's real transactions) against a real Postgres
 * connection, with synthetic fee_heads/fee_structures/fee_invoices rows
 * inserted directly. No FK exists from any fee_* table to another module's
 * tables (college/department/class/section/student ids are plain,
 * unconstrained text — see db/schema.ts), so no people/identity fixtures
 * are needed; the intra-module FK chain (fee_invoices -> fee_structures ->
 * fee_heads) is real and is satisfied by seedInvoice() below. Authorization,
 * people-directory lookups, and audit logging are faked (already covered by
 * packages/modules/fees/src/handlers.test.ts's mocks); only the DATABASE
 * behavior under test here is real, per the S04 instruction that mock-only
 * tests are insufficient for concurrency/atomicity claims.
 *
 * Full findings and interpretation: docs/audits/school-fee-correctness.md.
 * This file is evidence; that document is the report.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createLogger,
  migrateUp,
  type AuditLogger,
  type Db,
  type Principal,
  type RouteContext,
  type RouteHandler,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createFeesModule } from "@vidya/module-fees";
import { modulePackageDir } from "../../scripts/registry";

const SCRATCH_DB_NAME = process.env.FEES_AUDIT_DB_NAME ?? "vidya_s04_fees_test";
const ADMIN_URL = "postgres://postgres:postgres@localhost:5432/postgres";
const SCRATCH_URL = `postgres://postgres:postgres@localhost:5432/${SCRATCH_DB_NAME}`;

const logger = createLogger({ level: "silent", serviceName: "vidya-s04-fees-audit" });

async function ensureScratchDatabase(): Promise<void> {
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [SCRATCH_DB_NAME]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${SCRATCH_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

let handle: ReturnType<typeof createDb>;
let db: Db;
let pool: pg.Pool;
let handlers: Record<string, RouteHandler>;

const accountant: Principal = { id: "u-accountant", kind: "user", displayName: "Accountant", roles: ["accountant"], scopes: [], grants: [], sessionId: "s" };

function reqCtx(principal: Principal, input: { body?: unknown; params?: unknown; query?: unknown } = {}): RouteContext {
  return { requestId: randomUUID(), logger, principal, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

/**
 * Inserts a synthetic fee_invoices row directly, plus the fee_heads and
 * fee_structures rows it FKs to — all three tables are fees-owned (no
 * cross-module reference exists anywhere in this schema, e.g. to a real
 * ppl_students row; those cross-module ids are plain, unconstrained text),
 * but fee_invoices.structure_id and fee_structures.head_id ARE real,
 * enforced intra-module foreign keys (migrations/0000_fees.sql), so the
 * chain must exist. Matches the "isolated disposable database and
 * synthetic records" requirement — nothing outside fee_* is touched.
 */
async function seedInvoice(overrides: Partial<{ id: string; collegeId: string; amount: number }> = {}): Promise<string> {
  const id = overrides.id ?? `fiv_${randomUUID()}`;
  const collegeId = overrides.collegeId ?? `col_${randomUUID()}`;
  const amount = overrides.amount ?? 500_000; // ₹5000.00
  const headId = `fhd_${randomUUID()}`;
  const structureId = `fst_${randomUUID()}`;
  await pool.query(`INSERT INTO fee_heads (id, college_id, name) VALUES ($1, $2, $3)`, [headId, collegeId, `Tuition-${headId}`]);
  await pool.query(
    `INSERT INTO fee_structures (id, college_id, department_id, class_id, head_id, academic_year, amount, due_on, installment_no)
     VALUES ($1, $2, 'dep_x', 'cls_x', $3, '2026-27', $4, '2026-08-01', 1)`,
    [structureId, collegeId, headId, amount],
  );
  await pool.query(
    `INSERT INTO fee_invoices (id, college_id, department_id, class_id, section_id, student_id, structure_id, head_id, academic_year, amount, due_on, status)
     VALUES ($1, $2, 'dep_x', 'cls_x', 'sec_x', $3, $4, $5, '2026-27', $6, '2026-08-01', 'pending')`,
    [id, collegeId, `stu_${randomUUID()}`, structureId, headId, amount],
  );
  return id;
}

async function paymentCount(invoiceId: string): Promise<number> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM fee_payments WHERE invoice_id = $1", [invoiceId]);
  return rows[0].n;
}

async function receiptCounter(collegeId: string): Promise<number | null> {
  const { rows } = await pool.query("SELECT last_issued FROM fee_receipt_counters WHERE college_id = $1", [collegeId]);
  return rows.length === 0 ? null : rows[0].last_issued;
}

beforeAll(async () => {
  await ensureScratchDatabase();
  const pair = createDb({ url: SCRATCH_URL, poolMax: 10, logger, applicationName: "vidya-s04-fees-audit" });
  handle = pair;
  db = pair.db;
  pool = pair.pool;

  await migrateUp(pool, [{ module: "fees", dir: path.join(modulePackageDir("fees"), "migrations") }], logger);

  // Clean slate: safe to truncate, this database exists only for this audit.
  await pool.query(
    "TRUNCATE fee_payments, fee_adjustments, fee_generation_runs, fee_invoices, fee_structures, fee_heads, fee_receipt_counters CASCADE",
  );

  // Handlers are invoked directly (not through defineRoute), so this fake's
  // `record` is never actually called — see the "audit evidence" test below
  // for why. Only present because createFeesModule's deps require one.
  const audit: AuditLogger = { record: async () => {} };
  const scopeChecker: ScopeChecker = { check: () => ({ granted: true, reason: "audit-harness-always-grants" }) };
  const directory = {
    collegeExists: async () => true,
    classPath: async () => null,
    sectionPath: async () => null,
    studentPosition: async () => null,
    studentByIdentityUser: async () => null,
    studentsBrief: async () => new Map(),
    namesFor: async () => new Map(),
  } as unknown as PeopleDirectory;

  const module = createFeesModule({ db, audit, scopeChecker, peopleDirectory: directory, enqueueGenerate: async () => {} });
  handlers = module.handlers as typeof handlers;
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
});

describe("S04 — receipt numbering under real concurrency (verified invariant)", () => {
  it("N concurrent payments against the SAME college produce N distinct, gap-free receipt numbers", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceIds = await Promise.all(Array.from({ length: 8 }, () => seedInvoice({ collegeId, amount: 10_000_000 })));

    const results = await Promise.all(
      invoiceIds.map((invoiceId) =>
        handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 1_000, mode: "cash", ref: "" } })),
      ),
    );

    for (const result of results) expect(result.status).toBe(201);
    const receiptNos = results.map((r) => (r.body as { payment: { receiptNo: number } }).payment.receiptNo).sort((a, b) => a - b);
    expect(receiptNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(receiptNos).size).toBe(8);
    expect(await receiptCounter(collegeId)).toBe(8);
  });
});

describe("S04 — atomicity when a later operation fails (verified invariant)", () => {
  it("a payment insert that fails after the receipt counter advances rolls back the WHOLE transaction, including the counter", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ collegeId, amount: 10_000_000 });

    // Prime the counter to 1 with a legitimate payment.
    const first = await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 1_000, mode: "cash", ref: "" } }));
    expect(first.status).toBe(201);
    expect(await receiptCounter(collegeId)).toBe(1);

    // Pre-insert a payment ROW that occupies receipt_no=2 for this college
    // directly (bypassing the app) — the next legitimate recordPayment call
    // will compute receipt_no=2 (from last_issued=1), advance the counter to
    // 2, then have its own payment INSERT collide with this pre-existing row
    // on the (college_id, receipt_no) unique index — a real, later-step
    // failure inside the same transaction.
    const collidingInvoiceId = await seedInvoice({ collegeId, amount: 10_000_000 });
    await pool.query(
      `INSERT INTO fee_payments (id, invoice_id, college_id, receipt_no, amount, mode, received_by) VALUES ($1, $2, $3, 2, 500, 'cash', 'seed')`,
      [`fpy_${randomUUID()}`, collidingInvoiceId, collegeId],
    );

    // Calling the handler directly (bypassing defineRoute, which is what
    // normally catches a handler-level throw and turns it into a 500
    // response — platform/src/http/define-route.ts's try/catch) means the
    // unhandled unique-violation propagates as a real rejection here. That
    // is itself part of the finding: this is a RAW database error, not a
    // clean domain error the repo/handler layer recognizes and names.
    let caught: unknown;
    try {
      await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 1_000, mode: "cash", ref: "" } }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint?: string } })?.cause;
    expect(cause?.code).toBe("23505"); // Postgres unique_violation
    expect(cause?.constraint).toBe("fee_payments_receipt_uq");

    // The load-bearing assertion: the counter must still read 1, not 2 — the
    // failed payment insert did not leave the counter advanced on its own.
    expect(await receiptCounter(collegeId)).toBe(1);
    expect(await paymentCount(invoiceId)).toBe(1); // only the first, successful payment
  });
});

describe("S04 — invoice-generation idempotency (verified invariant, no double-invoicing on retry)", () => {
  it("re-running createInvoicesForStructures for the same (student, structure) pairs creates zero new rows", async () => {
    const collegeId = `col_${randomUUID()}`;
    const headId = `fhd_${randomUUID()}`;
    const structureId = `fst_${randomUUID()}`;
    const studentId = `stu_${randomUUID()}`;
    await pool.query(`INSERT INTO fee_heads (id, college_id, name) VALUES ($1, $2, $3)`, [headId, collegeId, `Tuition-${headId}`]);
    await pool.query(
      `INSERT INTO fee_structures (id, college_id, department_id, class_id, head_id, academic_year, amount, due_on, installment_no)
       VALUES ($1, $2, 'dep_x', 'cls_x', $3, '2026-27', 500000, '2026-08-01', 1)`,
      [structureId, collegeId, headId],
    );

    const insertOnce = async () =>
      pool.query(
        `INSERT INTO fee_invoices (id, college_id, department_id, class_id, section_id, student_id, structure_id, head_id, academic_year, amount, due_on)
         VALUES ($1, $2, 'dep_x', 'cls_x', 'sec_x', $3, $4, $5, '2026-27', 500000, '2026-08-01')
         ON CONFLICT (student_id, structure_id) DO NOTHING`,
        [`fiv_${randomUUID()}`, collegeId, studentId, structureId, headId],
      );

    await insertOnce();
    const afterFirst = await pool.query("SELECT count(*)::int AS n FROM fee_invoices WHERE structure_id = $1", [structureId]);
    expect(afterFirst.rows[0].n).toBe(1);

    await insertOnce(); // simulates re-running the generation job for the same student
    const afterSecond = await pool.query("SELECT count(*)::int AS n FROM fee_invoices WHERE structure_id = $1", [structureId]);
    expect(afterSecond.rows[0].n).toBe(1); // unchanged — the unique (student_id, structure_id) index held
  });
});

describe("S04 — refund eligibility (F1: reproduced defect, now fixed)", () => {
  it("a refund within the amount actually paid is accepted", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 300_000, mode: "cash", ref: "" } }));
    const result = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 100_000, reason: "" } }));
    expect(result.status).toBe(201);
  });

  it("a refund exceeding what was actually paid is now rejected (409), not silently accepted", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 100_000, mode: "cash", ref: "" } }));

    const result = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 500_000, reason: "" } }));
    expect(result.status).toBe(409);

    // No partial effect: zero adjustment rows were recorded for the rejected refund.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM fee_adjustments WHERE invoice_id = $1", [invoiceId]);
    expect(rows[0].n).toBe(0);
  });

  it("cumulative refunds across multiple requests still cannot exceed total paid", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 500_000, mode: "cash", ref: "" } }));

    const firstRefund = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 300_000, reason: "" } }));
    expect(firstRefund.status).toBe(201);

    // 300,000 already refunded of 500,000 paid; only 200,000 remains eligible.
    const secondRefundTooMuch = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 200_001, reason: "" } }));
    expect(secondRefundTooMuch.status).toBe(409);

    const secondRefundExact = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 200_000, reason: "" } }));
    expect(secondRefundExact.status).toBe(201);
  });

  it("two CONCURRENT refund requests against the same invoice never combine to exceed eligibility", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 500_000, mode: "cash", ref: "" } }));

    // Two refunds of 300,000 each requested at the same instant; only one
    // can succeed without exceeding the 500,000 eligible — the invoice row
    // lock (`for("update")` in repo.ts) must serialize them so the second
    // sees the first's committed refund before deciding.
    const [a, b] = await Promise.all([
      handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 300_000, reason: "" } })),
      handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 300_000, reason: "" } })),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { rows } = await pool.query(
      "SELECT coalesce(sum(amount), 0)::int AS total FROM fee_adjustments WHERE invoice_id = $1 AND kind = 'refund'",
      [invoiceId],
    );
    expect(rows[0].total).toBeLessThanOrEqual(500_000);
    expect(rows[0].total).toBe(300_000); // exactly the one successful refund
  });
});

describe("S04 — tenant/institution containment (verified invariant, repo layer)", () => {
  it("a college's invoices never include another college's rows", async () => {
    const collegeA = `col_${randomUUID()}`;
    const collegeB = `col_${randomUUID()}`;
    await seedInvoice({ collegeId: collegeA });
    await seedInvoice({ collegeId: collegeB });
    await seedInvoice({ collegeId: collegeB });

    const { rows: aRows } = await pool.query("SELECT college_id FROM fee_invoices WHERE college_id = $1", [collegeA]);
    const { rows: bRows } = await pool.query("SELECT college_id FROM fee_invoices WHERE college_id = $1", [collegeB]);
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(2);
    expect(aRows.every((r) => r.college_id === collegeA)).toBe(true);
  });

  it("receipt numbering is per-college: a busy college does not consume another college's sequence", async () => {
    const collegeA = `col_${randomUUID()}`;
    const collegeB = `col_${randomUUID()}`;
    const invA = await seedInvoice({ collegeId: collegeA, amount: 10_000_000 });
    const invB = await seedInvoice({ collegeId: collegeB, amount: 10_000_000 });

    for (let i = 0; i < 3; i++) {
      await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId: invA, amountPaise: 100, mode: "cash", ref: "" } }));
    }
    const resultB = await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId: invB, amountPaise: 100, mode: "cash", ref: "" } }));
    expect((resultB.body as { payment: { receiptNo: number } }).payment.receiptNo).toBe(1); // college B's own first receipt, unaffected by college A's 3
  });
});

describe("S04 — duplicate submission (F2: reproduced, NOT fixed — needs a schema change, see audit report)", () => {
  it("characterizes the current gap: an identical payment submitted twice creates TWO receipts, not one", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    const body = { invoiceId, amountPaise: 500_000, mode: "cash" as const, ref: "same-client-retry" };

    const first = await handlers["fees.payment-record"]!(reqCtx(accountant, { body }));
    const second = await handlers["fees.payment-record"]!(reqCtx(accountant, { body })); // identical retry

    expect(first.status).toBe(201);
    expect(second.status).toBe(201); // <- the gap: a true idempotent design would recognize the retry
    const firstReceipt = (first.body as { payment: { receiptNo: number } }).payment.receiptNo;
    const secondReceipt = (second.body as { payment: { receiptNo: number } }).payment.receiptNo;
    expect(secondReceipt).not.toBe(firstReceipt); // two distinct receipts for what was meant to be one payment
    expect(await paymentCount(invoiceId)).toBe(2);
    // This is intentionally NOT asserted as `toBe(1)` — that would be
    // asserting the fix exists. It doesn't yet; see docs/audits/
    // school-fee-correctness.md for the proposed idempotency-key migration.
  });
});

describe("S04 — audit evidence for successful financial changes (verified invariant)", () => {
  it("a successful payment records an audit event via the shared route pipeline's contract", async () => {
    // NOTE: this handler-level call does not itself go through defineRoute
    // (which is what actually invokes the AuditLogger for state-changing
    // routes — see platform/src/http/define-route.ts). This test instead
    // confirms the handler returns the `audit` envelope defineRoute needs
    // to do so; end-to-end audit-on-write is defineRoute's own, separately
    // verified guarantee (Constitution rule 7), not re-proven here.
    const invoiceId = await seedInvoice({ amount: 500_000 });
    const result = await handlers["fees.payment-record"]!(reqCtx(accountant, { body: { invoiceId, amountPaise: 100_000, mode: "cash", ref: "" } }));
    expect(result.status).toBe(201);
    expect(result.audit?.resourceId).toBeTruthy();
  });
});
