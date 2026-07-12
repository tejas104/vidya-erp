import type { OrgPath, Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import {
  DuplicateHeadError,
  DuplicateStructureError,
  HeadInUseError,
  InvoiceNotFoundError,
  InvoiceWaivedError,
  type FeesRepo,
} from "./repo";
import type {
  FeeAdjustmentRow,
  FeeGenerationRunRow,
  FeeHeadRow,
  FeeInvoiceRow,
  FeePaymentRow,
  FeeStructureRow,
} from "./db/schema";
import { computeLedger, type AdjustmentKind, type PaymentMode } from "./money";

export interface FeesHandlerDeps {
  readonly repo: FeesRepo;
  readonly directory: PeopleDirectory;
  readonly scopeChecker: ScopeChecker;
  /** Enqueues the invoice-generate worker job for a created run. */
  readonly enqueueGenerate: (payload: { runId: string }) => Promise<void>;
}

function notFound(message = "not found") {
  return { status: 404, body: { message } };
}
function denied() {
  return { status: 403, body: { message: "access denied" } };
}

function headView(row: FeeHeadRow) {
  return { id: row.id, collegeId: row.collegeId, name: row.name };
}

function structureView(row: FeeStructureRow, headName: string) {
  return {
    id: row.id,
    collegeId: row.collegeId,
    departmentId: row.departmentId,
    classId: row.classId,
    headId: row.headId,
    headName,
    academicYear: row.academicYear,
    amountPaise: row.amount,
    dueOn: row.dueOn,
    installmentNo: row.installmentNo,
  };
}

function paymentView(row: FeePaymentRow) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    receiptNo: row.receiptNo,
    amountPaise: row.amount,
    mode: row.mode,
    ref: row.ref,
    receivedBy: row.receivedBy,
    receivedAt: row.receivedAt.toISOString(),
  };
}

function adjustmentView(row: FeeAdjustmentRow) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    kind: row.kind,
    amountPaise: row.amount,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

function runView(row: FeeGenerationRunRow) {
  return {
    id: row.id,
    collegeId: row.collegeId,
    classId: row.classId,
    academicYear: row.academicYear,
    status: row.status,
    invoicesCreated: row.invoicesCreated,
    invoicesSkipped: row.invoicesSkipped,
    error: row.error,
  };
}

export function createFeesHandlers(deps: FeesHandlerDeps): Record<string, RouteHandler> {
  /** Org containment for reads — accountant/admin grants are college-scoped. */
  function readAllowed(principal: Principal, org: OrgPath): boolean {
    return deps.scopeChecker.check(principal, "read", { module: "fees", resourceType: "invoice", org }).granted;
  }

  /**
   * Fees writes: the accountant's authority comes from grantAllows (create on
   * module "fees"); admin's grantAllows deliberately excludes fees writes, so
   * the admin role passes on the role alone — but only after the read check
   * has proven org containment (same college), keeping tenancy fail-closed.
   */
  function writeAllowed(principal: Principal, org: OrgPath): boolean {
    if (!readAllowed(principal, org)) return false;
    if (principal.roles.includes("admin")) return true;
    return deps.scopeChecker.check(principal, "create", { module: "fees", resourceType: "payment", org }).granted;
  }

  /** Enriches invoice rows with names, admission numbers and live ledger totals.
   * ponytail: per-invoice payments/adjustments queries (N+1) — fine at section
   * size; batch with one IN-query if college-wide lists get slow. */
  async function invoiceViews(rows: readonly FeeInvoiceRow[]) {
    const briefs = await deps.directory.studentsBrief(rows.map((row) => row.studentId));
    const headNames = new Map<string, string>();
    for (const headId of new Set(rows.map((row) => row.headId))) {
      const head = await deps.repo.getHead(headId);
      headNames.set(headId, head?.name ?? headId);
    }
    return Promise.all(
      rows.map(async (row) => {
        const [payments, adjustments] = await Promise.all([
          deps.repo.paymentsForInvoice(row.id),
          deps.repo.adjustmentsForInvoice(row.id),
        ]);
        const ledger = computeLedger(
          row.amount,
          payments.map((p) => ({ amountPaise: p.amount })),
          adjustments.map((a) => ({ kind: a.kind, amountPaise: a.amount })),
        );
        const brief = briefs.get(row.studentId);
        return {
          view: {
            id: row.id,
            collegeId: row.collegeId,
            departmentId: row.departmentId,
            classId: row.classId,
            sectionId: row.sectionId,
            studentId: row.studentId,
            studentName: brief?.fullName ?? row.studentId,
            admissionNo: brief?.admissionNo ?? "",
            structureId: row.structureId,
            headId: row.headId,
            headName: headNames.get(row.headId) ?? row.headId,
            academicYear: row.academicYear,
            amountPaise: row.amount,
            dueOn: row.dueOn,
            status: row.status,
            paidPaise: ledger.effectivePaidPaise,
            duesPaise: Math.max(0, ledger.duesPaise),
          },
          payments,
          adjustments,
        };
      }),
    );
  }

  async function singleInvoiceView(row: FeeInvoiceRow) {
    return (await invoiceViews([row]))[0]!.view;
  }

  const headCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { collegeId: string; name: string };
    if (!(await deps.directory.collegeExists(body.collegeId))) return notFound("no such college");
    if (!readAllowed(principal, { collegeId: body.collegeId })) return denied();
    try {
      const row = await deps.repo.createHead(body.collegeId, body.name);
      return { status: 201, body: headView(row), audit: { resourceId: row.id, details: { name: row.name } } };
    } catch (error) {
      if (error instanceof DuplicateHeadError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const headList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string };
    if (!readAllowed(principal, { collegeId: query.collegeId })) return denied();
    const rows = await deps.repo.listHeads(query.collegeId);
    return { status: 200, body: { heads: rows.map(headView) } };
  };

  const headDelete: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { headId: string };
    const head = await deps.repo.getHead(params.headId);
    if (head === null) return notFound("no such head");
    if (!readAllowed(principal, { collegeId: head.collegeId })) return denied();
    try {
      await deps.repo.deleteHead(head.id);
      return { status: 200, body: { ok: true as const }, audit: { resourceId: head.id, details: { name: head.name } } };
    } catch (error) {
      if (error instanceof HeadInUseError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const structureCreate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as {
      classId: string; headId: string; academicYear: string;
      amountPaise: number; dueOn: string; installmentNo: number;
    };
    const path = await deps.directory.classPath(body.classId);
    if (path === null || path.departmentId === undefined) return notFound("no such class");
    const head = await deps.repo.getHead(body.headId);
    if (head === null || head.collegeId !== path.collegeId) return notFound("no such head");
    if (!readAllowed(principal, path)) return denied();
    try {
      const row = await deps.repo.createStructure({
        collegeId: path.collegeId,
        departmentId: path.departmentId,
        classId: body.classId,
        headId: body.headId,
        academicYear: body.academicYear,
        amountPaise: body.amountPaise,
        dueOn: body.dueOn,
        installmentNo: body.installmentNo,
      });
      return {
        status: 201,
        body: structureView(row, head.name),
        audit: { resourceId: row.id, details: { classId: row.classId, headId: row.headId, amountPaise: row.amount } },
      };
    } catch (error) {
      if (error instanceof DuplicateStructureError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const structureList: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { classId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.classPath(params.classId);
    if (path === null) return notFound("no such class");
    if (!readAllowed(principal, path)) return denied();
    const rows = await deps.repo.listStructuresForClass(params.classId, query.academicYear);
    const heads = new Map<string, string>();
    for (const headId of new Set(rows.map((row) => row.headId))) {
      heads.set(headId, (await deps.repo.getHead(headId))?.name ?? headId);
    }
    return { status: 200, body: { structures: rows.map((row) => structureView(row, heads.get(row.headId) ?? row.headId)) } };
  };

  const invoicesGenerate: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { classId: string; academicYear: string };
    const path = await deps.directory.classPath(body.classId);
    if (path === null) return notFound("no such class");
    if (!readAllowed(principal, path)) return denied();
    const run = await deps.repo.createRun({
      collegeId: path.collegeId,
      classId: body.classId,
      academicYear: body.academicYear,
      requestedBy: principal.id,
    });
    await deps.enqueueGenerate({ runId: run.id });
    return {
      status: 202,
      body: { runId: run.id },
      audit: { resourceId: run.id, details: { classId: body.classId, academicYear: body.academicYear } },
    };
  };

  const generateGet: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { runId: string };
    const run = await deps.repo.getRun(params.runId);
    if (run === null) return notFound("no such run");
    if (!readAllowed(principal, { collegeId: run.collegeId })) return denied();
    return { status: 200, body: runView(run) };
  };

  const studentInvoices: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { studentId: string };
    const position = await deps.directory.studentPosition(params.studentId);
    if (position === null) return notFound("no such student");
    let allowed = readAllowed(principal, position);
    if (!allowed && principal.roles.includes("student")) {
      // self-scope via the identity link — never an id the caller supplies
      const own = await deps.directory.studentByIdentityUser(principal.id);
      allowed = own !== null && own.studentId === params.studentId;
    }
    if (!allowed) return denied();
    const rows = await deps.repo.invoicesForStudent(params.studentId);
    return { status: 200, body: { invoices: (await invoiceViews(rows)).map((entry) => entry.view) } };
  };

  const sectionInvoices: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const params = ctx.request.params as { sectionId: string };
    const query = ctx.request.query as { academicYear: string };
    const path = await deps.directory.sectionPath(params.sectionId);
    if (path === null) return notFound("no such section");
    if (!readAllowed(principal, path)) return denied();
    const rows = await deps.repo.invoicesForSection(params.sectionId, query.academicYear);
    return { status: 200, body: { invoices: (await invoiceViews(rows)).map((entry) => entry.view) } };
  };

  const paymentRecord: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { invoiceId: string; amountPaise: number; mode: PaymentMode; ref: string };
    const invoice = await deps.repo.getInvoice(body.invoiceId);
    if (invoice === null) return notFound("no such invoice");
    const org: OrgPath = {
      collegeId: invoice.collegeId, departmentId: invoice.departmentId,
      classId: invoice.classId, sectionId: invoice.sectionId,
    };
    if (!writeAllowed(principal, org)) return denied();
    try {
      const { payment, invoice: updated } = await deps.repo.recordPayment({
        invoiceId: invoice.id,
        amountPaise: body.amountPaise,
        mode: body.mode,
        ref: body.ref,
        receivedBy: principal.id,
      });
      return {
        status: 201,
        body: { payment: paymentView(payment), invoice: await singleInvoiceView(updated) },
        audit: {
          resourceId: payment.id,
          details: { invoiceId: invoice.id, receiptNo: payment.receiptNo, amountPaise: payment.amount, mode: payment.mode },
        },
      };
    } catch (error) {
      if (error instanceof InvoiceNotFoundError) return notFound("no such invoice");
      if (error instanceof InvoiceWaivedError) return { status: 409, body: { message: error.message } };
      throw error;
    }
  };

  const adjustmentAdd: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const body = ctx.request.body as { invoiceId: string; kind: AdjustmentKind; amountPaise: number; reason: string };
    const invoice = await deps.repo.getInvoice(body.invoiceId);
    if (invoice === null) return notFound("no such invoice");
    const org: OrgPath = {
      collegeId: invoice.collegeId, departmentId: invoice.departmentId,
      classId: invoice.classId, sectionId: invoice.sectionId,
    };
    if (!writeAllowed(principal, org)) return denied();
    try {
      const { adjustment, invoice: updated } = await deps.repo.addAdjustment({
        invoiceId: invoice.id,
        kind: body.kind,
        amountPaise: body.amountPaise,
        reason: body.reason,
        actor: principal.id,
      });
      return {
        status: 201,
        body: { adjustment: adjustmentView(adjustment), invoice: await singleInvoiceView(updated) },
        audit: {
          resourceId: adjustment.id,
          details: { invoiceId: invoice.id, kind: adjustment.kind, amountPaise: adjustment.amount },
        },
      };
    } catch (error) {
      if (error instanceof InvoiceNotFoundError) return notFound("no such invoice");
      throw error;
    }
  };

  const myFees: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const own = await deps.directory.studentByIdentityUser(principal.id);
    if (own === null) return notFound("this sign-in is not linked to a student record");
    const rows = await deps.repo.invoicesForStudent(own.studentId);
    const entries = await invoiceViews(rows);
    return {
      status: 200,
      body: {
        invoices: entries.map((entry) => ({
          ...entry.view,
          payments: entry.payments.map(paymentView),
          adjustments: entry.adjustments.map(adjustmentView),
        })),
      },
    };
  };

  const collectionSummary: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string; from: string; to: string };
    if (!readAllowed(principal, { collegeId: query.collegeId })) return denied();
    const payments = await deps.repo.paymentsInRange(query.collegeId, query.from, query.to);
    const byMode = new Map<PaymentMode, { totalPaise: number; count: number }>();
    let totalPaise = 0;
    for (const payment of payments) {
      totalPaise += payment.amount;
      const bucket = byMode.get(payment.mode) ?? { totalPaise: 0, count: 0 };
      bucket.totalPaise += payment.amount;
      bucket.count += 1;
      byMode.set(payment.mode, bucket);
    }
    return {
      status: 200,
      body: {
        from: query.from,
        to: query.to,
        totalPaise,
        byMode: [...byMode.entries()].map(([mode, bucket]) => ({ mode, ...bucket })),
      },
    };
  };

  const defaulters: RouteHandler = async (ctx) => {
    const principal = ctx.principal as Principal;
    const query = ctx.request.query as { collegeId: string; academicYear: string };
    if (!readAllowed(principal, { collegeId: query.collegeId })) return denied();
    const rows = await deps.repo.invoicesForCollege(query.collegeId, query.academicYear, ["pending", "part"]);
    const entries = await invoiceViews(rows);
    return {
      status: 200,
      body: { defaulters: entries.map((entry) => entry.view).filter((view) => view.duesPaise > 0) },
    };
  };

  return {
    "fees.head-create": headCreate,
    "fees.head-list": headList,
    "fees.head-delete": headDelete,
    "fees.structure-create": structureCreate,
    "fees.structure-list": structureList,
    "fees.invoices-generate": invoicesGenerate,
    "fees.generate-get": generateGet,
    "fees.student-invoices": studentInvoices,
    "fees.section-invoices": sectionInvoices,
    "fees.payment-record": paymentRecord,
    "fees.adjustment-add": adjustmentAdd,
    "fees.my-fees": myFees,
    "fees.collection-summary": collectionSummary,
    "fees.defaulters": defaulters,
  };
}
