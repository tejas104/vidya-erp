import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { Principal, RouteContext, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { createFeesHandlers, type FeesHandlerDeps } from "./handlers";
import {
  DuplicateHeadError,
  DuplicateStructureError,
  HeadInUseError,
  InvoiceWaivedError,
  type FeesRepo,
} from "./repo";

const logger = pino({ level: "silent" });
const YEAR = "2026-27";

const admin: Principal = { id: "u_adm", kind: "user", displayName: "a", roles: ["admin"], scopes: [], grants: [], sessionId: "s" };
const accountant: Principal = { id: "u_acc", kind: "user", displayName: "b", roles: ["accountant"], scopes: [], grants: [], sessionId: "s" };
const teacher: Principal = { id: "u_t", kind: "user", displayName: "t", roles: ["teacher"], scopes: [], grants: [], sessionId: "s" };
const student: Principal = { id: "u_s", kind: "user", displayName: "s", roles: ["student"], scopes: [], grants: [], sessionId: "s" };

function ctx(principal: Principal, input: { params?: unknown; query?: unknown; body?: unknown } = {}): RouteContext {
  return { requestId: "r", logger, principal, request: { params: input.params, query: input.query, body: input.body, headers: new Headers() } };
}

const headRow = { id: "fhd_1", collegeId: "col_1", name: "Tuition", createdAt: new Date() };
const invoiceRow = {
  id: "fiv_1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1",
  studentId: "stu_1", structureId: "fst_1", headId: "fhd_1", academicYear: YEAR,
  amount: 50_000, dueOn: "2026-08-01", status: "pending" as const, createdAt: new Date(),
};
const paymentRow = {
  id: "fpy_1", invoiceId: "fiv_1", collegeId: "col_1", receiptNo: 7, amount: 50_000,
  mode: "cash" as const, ref: "", receivedBy: "u_acc", receivedAt: new Date("2026-07-13T10:00:00Z"),
};

interface Opts {
  duplicateHead?: boolean;
  headInUse?: boolean;
  duplicateStructure?: boolean;
  waived?: boolean;
  studentLinked?: boolean;
  payments?: (typeof paymentRow)[];
  /** action → granted (default: everything granted) */
  scope?: (action: string) => boolean;
}

function makeDeps(opts: Opts = {}) {
  const enqueued: { runId: string }[] = [];
  const repo = {
    createHead: async (collegeId: string, name: string) => {
      if (opts.duplicateHead) throw new DuplicateHeadError();
      return { ...headRow, collegeId, name };
    },
    listHeads: async () => [headRow],
    getHead: async () => headRow,
    deleteHead: async () => {
      if (opts.headInUse) throw new HeadInUseError();
      return true;
    },
    createStructure: async (input: Record<string, unknown>) => {
      if (opts.duplicateStructure) throw new DuplicateStructureError();
      return {
        id: "fst_1", collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", headId: "fhd_1",
        academicYear: YEAR, amount: 50_000, dueOn: "2026-08-01", installmentNo: 1, createdAt: new Date(),
        ...input,
      };
    },
    listStructuresForClass: async () => [],
    createRun: async () => ({
      id: "fgr_1", collegeId: "col_1", classId: "cls_1", academicYear: YEAR, status: "pending" as const,
      invoicesCreated: 0, invoicesSkipped: 0, error: null, requestedBy: "u_adm", createdAt: new Date(), finishedAt: null,
    }),
    getRun: async () => null,
    getInvoice: async () => invoiceRow,
    invoicesForStudent: async () => [invoiceRow],
    invoicesForSection: async () => [invoiceRow],
    invoicesForCollege: async () => [invoiceRow],
    paymentsForInvoice: async () => opts.payments ?? [],
    adjustmentsForInvoice: async () => [],
    paymentsInRange: async () => [paymentRow, { ...paymentRow, id: "fpy_2", receiptNo: 8, amount: 25_000, mode: "upi" as const }],
    recordPayment: async (input: { amountPaise: number }) => {
      if (opts.waived) throw new InvoiceWaivedError();
      return {
        payment: { ...paymentRow, amount: input.amountPaise },
        invoice: { ...invoiceRow, status: "paid" as const },
      };
    },
    addAdjustment: async (input: { kind: string; amountPaise: number }) => ({
      adjustment: {
        id: "fad_1", invoiceId: "fiv_1", collegeId: "col_1", kind: input.kind, amount: input.amountPaise,
        reason: "", actor: "u_acc", createdAt: new Date(),
      },
      invoice: { ...invoiceRow, status: "waived" as const },
    }),
  } as unknown as FeesRepo;

  const directory = {
    collegeExists: async () => true,
    classPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1" }),
    sectionPath: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    studentPosition: async () => ({ collegeId: "col_1", departmentId: "dep_1", classId: "cls_1", sectionId: "sec_1" }),
    studentByIdentityUser: async () =>
      opts.studentLinked === false ? null : { studentId: "stu_1", collegeId: "col_1", fullName: "Aarav", admissionNo: "FYCS-001", status: "active" },
    studentsBrief: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, { fullName: "Aarav Sharma", admissionNo: "FYCS-001" }])),
    namesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `n:${id}`])),
  } as unknown as PeopleDirectory;

  const scopeChecker = {
    check: (_p: unknown, action: string) => ({ granted: opts.scope ? opts.scope(action) : true, reason: "test" }),
  } as unknown as ScopeChecker;

  const deps: FeesHandlerDeps = {
    repo, directory, scopeChecker,
    enqueueGenerate: async (payload) => { enqueued.push(payload); },
  };
  return { deps, enqueued };
}

describe("fees handlers", () => {
  it("maps a duplicate head name to 409", async () => {
    const handlers = createFeesHandlers(makeDeps({ duplicateHead: true }).deps);
    const result = await handlers["fees.head-create"]!(ctx(admin, { body: { collegeId: "col_1", name: "Tuition" } }));
    expect(result.status).toBe(409);
  });

  it("blocks deleting a head that a structure references (409)", async () => {
    const handlers = createFeesHandlers(makeDeps({ headInUse: true }).deps);
    const result = await handlers["fees.head-delete"]!(ctx(admin, { params: { headId: "fhd_1" } }));
    expect(result.status).toBe(409);
  });

  it("maps a duplicate structure to 409", async () => {
    const handlers = createFeesHandlers(makeDeps({ duplicateStructure: true }).deps);
    const result = await handlers["fees.structure-create"]!(
      ctx(admin, { body: { classId: "cls_1", headId: "fhd_1", academicYear: YEAR, amountPaise: 50_000, dueOn: "2026-08-01", installmentNo: 1 } }),
    );
    expect(result.status).toBe(409);
  });

  it("enqueues the generate job and answers 202 with the run id", async () => {
    const { deps, enqueued } = makeDeps();
    const handlers = createFeesHandlers(deps);
    const result = await handlers["fees.invoices-generate"]!(ctx(admin, { body: { classId: "cls_1", academicYear: YEAR } }));
    expect(result.status).toBe(202);
    expect((result.body as { runId: string }).runId).toBe("fgr_1");
    expect(enqueued).toEqual([{ runId: "fgr_1" }]);
  });

  it("records a payment (201) with the issued receipt number and ledger view", async () => {
    const handlers = createFeesHandlers(makeDeps({ payments: [paymentRow] }).deps);
    const result = await handlers["fees.payment-record"]!(
      ctx(accountant, { body: { invoiceId: "fiv_1", amountPaise: 50_000, mode: "cash", ref: "" } }),
    );
    expect(result.status).toBe(201);
    const body = result.body as { payment: { receiptNo: number }; invoice: { studentName: string; paidPaise: number } };
    expect(body.payment.receiptNo).toBe(7);
    expect(body.invoice.studentName).toBe("Aarav Sharma");
    expect(body.invoice.paidPaise).toBe(50_000);
  });

  it("answers 409 when paying a waived invoice", async () => {
    const handlers = createFeesHandlers(makeDeps({ waived: true }).deps);
    const result = await handlers["fees.payment-record"]!(
      ctx(accountant, { body: { invoiceId: "fiv_1", amountPaise: 1000, mode: "cash", ref: "" } }),
    );
    expect(result.status).toBe(409);
  });

  it("denies fees writes to a teacher even when reads are in scope", async () => {
    const handlers = createFeesHandlers(makeDeps({ scope: (action) => action === "read" }).deps);
    const result = await handlers["fees.payment-record"]!(
      ctx(teacher, { body: { invoiceId: "fiv_1", amountPaise: 1000, mode: "cash", ref: "" } }),
    );
    expect(result.status).toBe(403);
  });

  it("lets admin write fees records on the role (grantAllows excludes fees writes for admin)", async () => {
    const handlers = createFeesHandlers(makeDeps({ scope: (action) => action === "read" }).deps);
    const result = await handlers["fees.payment-record"]!(
      ctx(admin, { body: { invoiceId: "fiv_1", amountPaise: 1000, mode: "cash", ref: "" } }),
    );
    expect(result.status).toBe(201);
  });

  it("denies out-of-scope reads before touching data", async () => {
    const handlers = createFeesHandlers(makeDeps({ scope: () => false }).deps);
    const result = await handlers["fees.section-invoices"]!(
      ctx(teacher, { params: { sectionId: "sec_1" }, query: { academicYear: YEAR } }),
    );
    expect(result.status).toBe(403);
  });

  it("lets a student read their own invoices via the identity link only", async () => {
    const handlers = createFeesHandlers(makeDeps({ scope: () => false }).deps);
    const own = await handlers["fees.student-invoices"]!(ctx(student, { params: { studentId: "stu_1" } }));
    expect(own.status).toBe(200);
    const other = await handlers["fees.student-invoices"]!(ctx(student, { params: { studentId: "stu_2" } }));
    expect(other.status).toBe(403);
  });

  it("404s an unlinked sign-in on my-fees", async () => {
    const handlers = createFeesHandlers(makeDeps({ studentLinked: false }).deps);
    const result = await handlers["fees.my-fees"]!(ctx(student));
    expect(result.status).toBe(404);
  });

  it("my-fees carries payment history and computed dues", async () => {
    const handlers = createFeesHandlers(makeDeps({ payments: [{ ...paymentRow, amount: 20_000 }] }).deps);
    const result = await handlers["fees.my-fees"]!(ctx(student));
    expect(result.status).toBe(200);
    const body = result.body as { invoices: { duesPaise: number; payments: { receiptNo: number }[] }[] };
    expect(body.invoices[0]!.duesPaise).toBe(30_000);
    expect(body.invoices[0]!.payments[0]!.receiptNo).toBe(7);
  });

  it("collection summary totals and groups by mode", async () => {
    const handlers = createFeesHandlers(makeDeps().deps);
    const result = await handlers["fees.collection-summary"]!(
      ctx(accountant, { query: { collegeId: "col_1", from: "2026-07-01", to: "2026-07-13" } }),
    );
    expect(result.status).toBe(200);
    const body = result.body as { totalPaise: number; byMode: { mode: string; count: number }[] };
    expect(body.totalPaise).toBe(75_000);
    expect(body.byMode).toHaveLength(2);
  });

  it("defaulters excludes invoices whose ledger has no dues", async () => {
    const handlers = createFeesHandlers(makeDeps({ payments: [paymentRow] }).deps);
    const result = await handlers["fees.defaulters"]!(
      ctx(accountant, { query: { collegeId: "col_1", academicYear: YEAR } }),
    );
    expect(result.status).toBe(200);
    expect((result.body as { defaulters: unknown[] }).defaulters).toHaveLength(0);
  });
});
