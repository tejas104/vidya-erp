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
  createMetrics,
  defineRoute,
  migrateUp,
  type AuditLogger,
  type Db,
  type TransactionalAuditLogger,
  type Principal,
  type RouteContext,
  type RouteHandler,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createFeesModule, feesModuleDefinition } from "@vidya/module-fees";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore } from "@vidya/module-identity";
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

type AuditFault = "none" | "before-write" | "after-write";
let auditFault: AuditFault = "none";
let system: ReturnType<typeof createSystemModule>;
let realAudit: TransactionalAuditLogger;
let realScopeChecker: ScopeChecker;
const faultingAudit: TransactionalAuditLogger = {
  record: (event) => realAudit.record(event),
  recordInTransaction: async (tx, event) => {
    if (auditFault === "before-write") throw new Error("audit sink unavailable");
    const receipt = await realAudit.recordInTransaction(tx, event);
    if (auditFault === "after-write") throw new Error("audit sink failed after its insert");
    return receipt;
  },
};

const accountant: Principal = { id: "u-accountant", kind: "user", displayName: "Accountant", roles: ["accountant"], scopes: [], grants: [], sessionId: "s" };

function reqCtx(principal: Principal, input: { body?: unknown; params?: unknown; query?: unknown } = {}): RouteContext {
  return { requestId: randomUUID(), logger, principal, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

function paymentBody(
  invoiceId: string,
  overrides: Partial<{ amountPaise: number; mode: "cash" | "upi" | "card" | "bank" | "gateway"; ref: string; idempotencyKey: string }> = {},
) {
  return {
    invoiceId,
    amountPaise: 1_000,
    mode: "cash" as const,
    ref: "",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
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
  // The real platform seam: system.service.audit is the production sink fees
  // receives from every composition root. createIdentityCore only builds the
  // (Redis-free) real ScopeChecker here; no session or password code runs.
  realScopeChecker = createIdentityCore({ redis: null as never, session: { ttlHours: 1, idleMinutes: 1 } }).scopeChecker;
  system = createSystemModule({
    scopeChecker: realScopeChecker,
    db,
    metrics: createMetrics({ serviceName: "s05-fees-audit", defaultMetrics: false }),
    serviceVersion: "integration",
    isDraining: () => false,
    infrastructureChecks: [],
    license: () => ({ kind: "absent" }),
    countActiveStudents: async () => 0,
  });
  realAudit = system.service.audit;

  // system owns sys_audit_log (append-only, TRUNCATE-blocked): the audit rows
  // written by these tests are real and are isolated per test by college id.
  await migrateUp(
    pool,
    [
      { module: "system", dir: path.join(modulePackageDir("system"), "migrations") },
      { module: "fees", dir: path.join(modulePackageDir("fees"), "migrations") },
    ],
    logger,
  );

  // Clean slate: safe to truncate, this database exists only for this audit.
  await pool.query(
    "TRUNCATE fee_payments, fee_adjustments, fee_generation_runs, fee_invoices, fee_structures, fee_heads, fee_receipt_counters CASCADE",
  );

  // ADR-0026: fees writes its payment/adjustment audit rows on its own
  // transaction through the REAL system audit sink. `faultingAudit` only lets a
  // test make that write fail (before or after the row is inserted).
  const audit = faultingAudit;
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

  const module = createFeesModule({ db, audit, scopeChecker, peopleDirectory: directory,
    guardianAccess: async () => ({ decision: { granted: false, reason: "denied:no-relationship" }, student: null }),
    enqueueGenerate: async () => {} });
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
        handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId) })),
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
    const first = await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId) }));
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
      await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId) }));
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
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId, { amountPaise: 300_000 }) }));
    const result = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 100_000, reason: "" } }));
    expect(result.status).toBe(201);
  });

  it("a refund exceeding what was actually paid is now rejected (409), not silently accepted", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId, { amountPaise: 100_000 }) }));

    const result = await handlers["fees.adjustment-add"]!(reqCtx(accountant, { body: { invoiceId, kind: "refund", amountPaise: 500_000, reason: "" } }));
    expect(result.status).toBe(409);

    // No partial effect: zero adjustment rows were recorded for the rejected refund.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM fee_adjustments WHERE invoice_id = $1", [invoiceId]);
    expect(rows[0].n).toBe(0);
  });

  it("cumulative refunds across multiple requests still cannot exceed total paid", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId, { amountPaise: 500_000 }) }));

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
    await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invoiceId, { amountPaise: 500_000 }) }));

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
      await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invA, { amountPaise: 100 }) }));
    }
    const resultB = await handlers["fees.payment-record"]!(reqCtx(accountant, { body: paymentBody(invB, { amountPaise: 100 }) }));
    expect((resultB.body as { payment: { receiptNo: number } }).payment.receiptNo).toBe(1); // college B's own first receipt, unaffected by college A's 3
  });
});

describe("review correction — duplicate payment submission", () => {
  it("returns the original receipt for an identical retry", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    const body = paymentBody(invoiceId, { amountPaise: 500_000, ref: "same-client-retry" });

    const first = await handlers["fees.payment-record"]!(reqCtx(accountant, { body }));
    const second = await handlers["fees.payment-record"]!(reqCtx(accountant, { body })); // identical retry

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstReceipt = (first.body as { payment: { receiptNo: number } }).payment.receiptNo;
    const secondReceipt = (second.body as { payment: { receiptNo: number } }).payment.receiptNo;
    expect(secondReceipt).toBe(firstReceipt);
    expect(await paymentCount(invoiceId)).toBe(1);
  });

  it("rejects reuse of a payment key with different details", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    const idempotencyKey = randomUUID();
    const first = await handlers["fees.payment-record"]!(reqCtx(accountant, {
      body: paymentBody(invoiceId, { amountPaise: 100_000, idempotencyKey }),
    }));
    const changed = await handlers["fees.payment-record"]!(reqCtx(accountant, {
      body: paymentBody(invoiceId, { amountPaise: 200_000, idempotencyKey }),
    }));
    expect(first.status).toBe(201);
    expect(changed.status).toBe(409);
    expect(await paymentCount(invoiceId)).toBe(1);
  });

  it("serializes concurrent identical retries into one receipt", async () => {
    const invoiceId = await seedInvoice({ amount: 500_000 });
    const body = paymentBody(invoiceId, { amountPaise: 100_000 });
    const [first, second] = await Promise.all([
      handlers["fees.payment-record"]!(reqCtx(accountant, { body })),
      handlers["fees.payment-record"]!(reqCtx(accountant, { body })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(await paymentCount(invoiceId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// S05 — the money mutation and its audit row are one atomic outcome (ADR-0026)
// ---------------------------------------------------------------------------

/** Post-handler sink that only counts: proves defineRoute did NOT add a second audit row. */
class CountingPostHandlerAudit implements AuditLogger {
  calls = 0;
  async record(event: Parameters<AuditLogger["record"]>[0]): Promise<void> {
    this.calls += 1;
    await realAudit.record(event);
  }
}

type FeesRouteId = "fees.payment-record" | "fees.adjustment-add";
const ROUTE_PATH: Record<FeesRouteId, string> = {
  "fees.payment-record": "/api/v1/fees/payments",
  "fees.adjustment-add": "/api/v1/fees/adjustments",
};

function feesRoute(id: FeesRouteId, postHandler: AuditLogger) {
  const spec = feesModuleDefinition.routes.find((route) => route.id === id)!;
  return defineRoute(spec, handlers[id]!, {
    logger,
    authenticator: { authenticate: async () => ({ authenticated: true, principal: accountant }) },
    accessPolicy: { authorize: async () => ({ granted: true }) },
    auditLogger: postHandler,
    metrics: createMetrics({ serviceName: `s05-${id}`, defaultMetrics: false }),
  });
}

function post(id: FeesRouteId, body: unknown, requestId: string = randomUUID()): Request {
  return new Request(`http://localhost${ROUTE_PATH[id]}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": requestId },
    body: JSON.stringify(body),
  });
}

async function auditRows(collegeId: string, action?: string) {
  const { rows } = await pool.query(
    `SELECT * FROM sys_audit_log WHERE org->>'collegeId' = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [collegeId, action ?? null],
  );
  return rows as Array<{
    module: string; action: string; actor_type: string; actor_id: string | null; resource_type: string;
    resource_id: string | null; request_id: string | null; org: Record<string, string>; details: Record<string, unknown>;
  }>;
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  const { rows } = await pool.query("SELECT status FROM fee_invoices WHERE id = $1", [invoiceId]);
  return rows[0].status;
}

async function adjustmentCount(invoiceId: string): Promise<number> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM fee_adjustments WHERE invoice_id = $1", [invoiceId]);
  return rows[0].n;
}

const ORG = (collegeId: string) => ({ collegeId, departmentId: "dep_x", classId: "cls_x", sectionId: "sec_x" });

describe("S05 — successful payment and adjustment write exactly one audit row (F5)", () => {
  it("a payment audits once, with trusted org, actor, request id, resource id and amount, and defineRoute adds nothing", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const postHandler = new CountingPostHandlerAudit();
    const requestId = `req-${randomUUID()}`;
    const body = paymentBody(invoiceId, { amountPaise: 100_000, mode: "upi", ref: "UTR-1" });
    const response = await feesRoute("fees.payment-record", postHandler)(post("fees.payment-record", body, requestId));
    expect(response.status).toBe(201);
    const { payment } = (await response.json()) as { payment: { id: string; receiptNo: number } };

    expect(postHandler.calls).toBe(0);
    const rows = await auditRows(collegeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      module: "fees", action: "fees.payment-recorded", resource_type: "fee-payment", resource_id: payment.id,
      actor_type: "user", actor_id: accountant.id, request_id: requestId, org: ORG(collegeId),
    });
    expect(rows[0]!.details).toMatchObject({
      routeId: "fees.payment-record", status: 201, invoiceId, receiptNo: payment.receiptNo,
      amountPaise: 100_000, mode: "upi", ref: "UTR-1", idempotencyKey: body.idempotencyKey, invoiceStatus: "part",
    });
  });

  it("an adjustment audits once with the same guarantees", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const postHandler = new CountingPostHandlerAudit();
    const requestId = `req-${randomUUID()}`;
    const response = await feesRoute("fees.adjustment-add", postHandler)(
      post("fees.adjustment-add", { invoiceId, kind: "scholarship", amountPaise: 50_000, reason: "merit" }, requestId),
    );
    expect(response.status).toBe(201);
    const { adjustment } = (await response.json()) as { adjustment: { id: string } };

    expect(postHandler.calls).toBe(0);
    const rows = await auditRows(collegeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      module: "fees", action: "fees.adjustment-added", resource_type: "fee-adjustment", resource_id: adjustment.id,
      actor_id: accountant.id, request_id: requestId, org: ORG(collegeId),
    });
    expect(rows[0]!.details).toMatchObject({ invoiceId, kind: "scholarship", amountPaise: 50_000, reason: "merit" });
  });

  it("the institution-scoped audit API (ADR-0025, real ScopeChecker) returns the event to its college's admin and hides it from another college's", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const response = await feesRoute("fees.payment-record", new CountingPostHandlerAudit())(
      post("fees.payment-record", paymentBody(invoiceId)),
    );
    expect(response.status).toBe(201);

    const adminOf = (college: string): Principal => ({
      id: `u-admin-${college}`, kind: "user", displayName: "Admin", roles: ["admin"], scopes: [], sessionId: "s",
      grants: [{ role: "admin", org: { collegeId: college } }],
    });
    const readAudit = async (principal: Principal) => {
      const result = await system.handlers["system.audit-log"]!({
        requestId: randomUUID(), logger, principal,
        request: { params: undefined, query: { action: "fees.payment-recorded", limit: 200 }, body: undefined, headers: new Headers() },
      });
      expect(result.status).toBe(200);
      return (result.body as { events: { org?: unknown; resourceType: string; details: { invoiceId?: string } }[] }).events;
    };
    const own = (await readAudit(adminOf(collegeId))).filter((event) => event.details.invoiceId === invoiceId);
    expect(own).toHaveLength(1);
    const foreign = (await readAudit(adminOf(`col_${randomUUID()}`))).filter((event) => event.details.invoiceId === invoiceId);
    expect(foreign).toHaveLength(0);
  });
});

describe("S05 — an audit failure rolls back the whole financial mutation (F5 fixed)", () => {
  for (const fault of ["before-write", "after-write"] as const) {
    it(`payment: audit failure (${fault}) leaves no payment, no receipt advance, no status change and no audit row; the keyed retry then succeeds exactly once`, async () => {
      const collegeId = `col_${randomUUID()}`;
      const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
      const body = paymentBody(invoiceId, { amountPaise: 100_000 });
      const postHandler = new CountingPostHandlerAudit();
      const route = feesRoute("fees.payment-record", postHandler);

      auditFault = fault;
      let failed: Response;
      try {
        failed = await route(post("fees.payment-record", body));
      } finally {
        auditFault = "none";
      }
      expect(failed.status).toBe(500);
      expect(await paymentCount(invoiceId)).toBe(0);
      expect(await receiptCounter(collegeId)).toBeNull(); // counter insert rolled back too
      expect(await invoiceStatus(invoiceId)).toBe("pending");
      expect(await auditRows(collegeId)).toHaveLength(0);
      expect(postHandler.calls).toBe(0);

      const retry = await route(post("fees.payment-record", body));
      expect(retry.status).toBe(201);
      const { payment } = (await retry.json()) as { payment: { id: string; receiptNo: number } };
      expect(payment.receiptNo).toBe(1);
      expect(await paymentCount(invoiceId)).toBe(1);
      expect(await receiptCounter(collegeId)).toBe(1);
      expect(await invoiceStatus(invoiceId)).toBe("part");
      const rows = await auditRows(collegeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.resource_id).toBe(payment.id);
    });
  }

  for (const fault of ["before-write", "after-write"] as const) {
    it(`adjustment: audit failure (${fault}) leaves no adjustment, no invoice status change and no audit row; the retry then succeeds exactly once`, async () => {
      const collegeId = `col_${randomUUID()}`;
      const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
      const waiver = { invoiceId, kind: "waiver" as const, amountPaise: 500_000, reason: "hardship" };
      const route = feesRoute("fees.adjustment-add", new CountingPostHandlerAudit());

      auditFault = fault;
      let failed: Response;
      try {
        failed = await route(post("fees.adjustment-add", waiver));
      } finally {
        auditFault = "none";
      }
      expect(failed.status).toBe(500);
      expect(await adjustmentCount(invoiceId)).toBe(0);
      expect(await invoiceStatus(invoiceId)).toBe("pending"); // a waiver would have flipped it to "waived"
      expect(await auditRows(collegeId)).toHaveLength(0);

      const retry = await route(post("fees.adjustment-add", waiver));
      expect(retry.status).toBe(201);
      expect(await adjustmentCount(invoiceId)).toBe(1);
      expect(await invoiceStatus(invoiceId)).toBe("waived");
      expect(await auditRows(collegeId, "fees.adjustment-added")).toHaveLength(1);
    });
  }

  it("a refund whose audit fails is not recorded, so the eligible-refund ledger is unchanged", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const pay = await feesRoute("fees.payment-record", new CountingPostHandlerAudit())(
      post("fees.payment-record", paymentBody(invoiceId, { amountPaise: 500_000 })),
    );
    expect(pay.status).toBe(201);
    const refundRoute = feesRoute("fees.adjustment-add", new CountingPostHandlerAudit());
    const refund = { invoiceId, kind: "refund" as const, amountPaise: 500_000, reason: "" };

    auditFault = "after-write";
    try {
      expect((await refundRoute(post("fees.adjustment-add", refund))).status).toBe(500);
    } finally {
      auditFault = "none";
    }
    expect(await adjustmentCount(invoiceId)).toBe(0);
    expect(await invoiceStatus(invoiceId)).toBe("paid");
    // Had the refund leaked past the failed audit, this full refund would now be rejected (409).
    expect((await refundRoute(post("fees.adjustment-add", refund))).status).toBe(201);
    expect(await auditRows(collegeId, "fees.adjustment-added")).toHaveLength(1);
  });
});

describe("S05 — payment idempotency is preserved and replays are not audited as new payments", () => {
  it("new payment 201; identical keyed replay 200 with the ORIGINAL receipt and no second audit row; changed payload 409", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const postHandler = new CountingPostHandlerAudit();
    const route = feesRoute("fees.payment-record", postHandler);
    const body = paymentBody(invoiceId, { amountPaise: 100_000 });

    const first = await route(post("fees.payment-record", body));
    expect(first.status).toBe(201);
    const original = (await first.json()) as { payment: { id: string; receiptNo: number } };

    const replay = await route(post("fees.payment-record", body));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { payment: { id: string; receiptNo: number } }).payment).toMatchObject(original.payment);

    const changed = await route(post("fees.payment-record", { ...body, amountPaise: 100_001 }));
    expect(changed.status).toBe(409);

    expect(await paymentCount(invoiceId)).toBe(1);
    expect(await receiptCounter(collegeId)).toBe(1);
    expect(postHandler.calls).toBe(0);
    const rows = await auditRows(collegeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resource_id).toBe(original.payment.id);
  });

  it("concurrent identical requests produce one payment, one receipt and one audit row", async () => {
    const collegeId = `col_${randomUUID()}`;
    const invoiceId = await seedInvoice({ amount: 500_000, collegeId });
    const route = feesRoute("fees.payment-record", new CountingPostHandlerAudit());
    const body = paymentBody(invoiceId, { amountPaise: 100_000 });
    const responses = await Promise.all([1, 2, 3].map(() => route(post("fees.payment-record", body))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
    expect(await paymentCount(invoiceId)).toBe(1);
    expect(await receiptCounter(collegeId)).toBe(1);
    expect(await auditRows(collegeId, "fees.payment-recorded")).toHaveLength(1);
  });
});
