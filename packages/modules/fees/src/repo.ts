import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import {
  feeAdjustments,
  feeGenerationRuns,
  feeHeads,
  feeInvoices,
  feePayments,
  feeReceiptCounters,
  feeStructures,
  type FeeAdjustmentRow,
  type FeeGenerationRunRow,
  type FeeHeadRow,
  type FeeInvoiceRow,
  type FeePaymentRow,
  type FeeStructureRow,
} from "./db/schema";
import { computeLedger, computeStatus, nextReceiptNo, type AdjustmentKind, type InvoiceStatus, type PaymentMode } from "./money";

function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
}

export class DuplicateHeadError extends Error {
  constructor() {
    super("a fee head with this name already exists for this college");
    this.name = "DuplicateHeadError";
  }
}
export class HeadInUseError extends Error {
  constructor() {
    super("this fee head is still referenced by a fee structure");
    this.name = "HeadInUseError";
  }
}
export class DuplicateStructureError extends Error {
  constructor() {
    super("a structure already exists for this class/head/year/installment");
    this.name = "DuplicateStructureError";
  }
}
export class InvoiceNotFoundError extends Error {
  constructor() {
    super("no such invoice");
    this.name = "InvoiceNotFoundError";
  }
}
export class InvoiceWaivedError extends Error {
  constructor() {
    super("invoice is waived; no further payments accepted");
    this.name = "InvoiceWaivedError";
  }
}

export interface NewStructure {
  readonly collegeId: string;
  readonly departmentId: string;
  readonly classId: string;
  readonly headId: string;
  readonly academicYear: string;
  readonly amountPaise: number;
  readonly dueOn: string;
  readonly installmentNo: number;
}

export interface InvoiceTarget {
  readonly studentId: string;
  readonly sectionId: string;
}

export interface NewPayment {
  readonly invoiceId: string;
  readonly amountPaise: number;
  readonly mode: PaymentMode;
  readonly ref: string;
  readonly receivedBy: string;
}

export interface NewAdjustment {
  readonly invoiceId: string;
  readonly kind: AdjustmentKind;
  readonly amountPaise: number;
  readonly reason: string;
  readonly actor: string;
}

export interface FeesRepo {
  // heads
  createHead(collegeId: string, name: string): Promise<FeeHeadRow>;
  listHeads(collegeId: string): Promise<FeeHeadRow[]>;
  getHead(id: string): Promise<FeeHeadRow | null>;
  /** Throws HeadInUseError on 23503 (a structure still references it). */
  deleteHead(id: string): Promise<boolean>;

  // structures
  createStructure(input: NewStructure): Promise<FeeStructureRow>;
  getStructure(id: string): Promise<FeeStructureRow | null>;
  listStructuresForClass(classId: string, academicYear: string): Promise<FeeStructureRow[]>;

  // generation runs (mirrors ppl_imports — poll-friendly bookkeeping)
  createRun(input: { collegeId: string; classId: string; academicYear: string; requestedBy: string }): Promise<FeeGenerationRunRow>;
  getRun(id: string): Promise<FeeGenerationRunRow | null>;
  markRunning(id: string): Promise<void>;
  finishRun(
    id: string,
    outcome: { status: "completed" | "failed"; invoicesCreated: number; invoicesSkipped: number; error: string | null },
  ): Promise<void>;

  // invoices
  /** Bulk-idempotent: (studentId, structureId) is unique, so re-running only invoices new pairs. */
  createInvoicesForStructures(
    structures: readonly FeeStructureRow[],
    students: readonly InvoiceTarget[],
  ): Promise<{ created: number; skipped: number }>;
  invoicesForStudent(studentId: string): Promise<FeeInvoiceRow[]>;
  invoicesForSection(sectionId: string, academicYear: string): Promise<FeeInvoiceRow[]>;
  invoicesForCollege(collegeId: string, academicYear: string, statuses?: readonly InvoiceStatus[]): Promise<FeeInvoiceRow[]>;
  getInvoice(id: string): Promise<FeeInvoiceRow | null>;

  // payments
  paymentsForInvoice(invoiceId: string): Promise<FeePaymentRow[]>;
  paymentsInRange(collegeId: string, fromIso: string, toIso: string): Promise<FeePaymentRow[]>;
  /** tx: issues the next per-college receipt no, inserts the payment, recomputes + persists invoice status.
   * Throws InvoiceNotFoundError / InvoiceWaivedError. */
  recordPayment(input: NewPayment): Promise<{ payment: FeePaymentRow; invoice: FeeInvoiceRow }>;

  // adjustments
  adjustmentsForInvoice(invoiceId: string): Promise<FeeAdjustmentRow[]>;
  /** tx: inserts the adjustment, recomputes + persists invoice status. Throws InvoiceNotFoundError. */
  addAdjustment(input: NewAdjustment): Promise<{ adjustment: FeeAdjustmentRow; invoice: FeeInvoiceRow }>;
}

/** Recomputes and persists an invoice's status from its current ledger (used after any payment/adjustment write). */
async function recomputeStatus(
  tx: Db,
  invoice: FeeInvoiceRow,
): Promise<FeeInvoiceRow> {
  const [payments, adjustments] = await Promise.all([
    tx.select().from(feePayments).where(eq(feePayments.invoiceId, invoice.id)),
    tx.select().from(feeAdjustments).where(eq(feeAdjustments.invoiceId, invoice.id)),
  ]);
  const ledger = computeLedger(
    invoice.amount,
    payments.map((p) => ({ amountPaise: p.amount })),
    adjustments.map((a) => ({ kind: a.kind, amountPaise: a.amount })),
  );
  const status = computeStatus(ledger);
  const rows = await tx.update(feeInvoices).set({ status }).where(eq(feeInvoices.id, invoice.id)).returning();
  return rows[0]!;
}

export function createFeesRepo(db: Db): FeesRepo {
  return {
    async createHead(collegeId, name) {
      try {
        const rows = await db.insert(feeHeads).values({ id: `fhd_${randomUUID()}`, collegeId, name }).returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateHeadError();
        throw error;
      }
    },

    async listHeads(collegeId) {
      return db.select().from(feeHeads).where(eq(feeHeads.collegeId, collegeId)).orderBy(asc(feeHeads.name));
    },

    async getHead(id) {
      const rows = await db.select().from(feeHeads).where(eq(feeHeads.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async deleteHead(id) {
      try {
        const rows = await db.delete(feeHeads).where(eq(feeHeads.id, id)).returning({ id: feeHeads.id });
        return rows.length > 0;
      } catch (error) {
        if (pgErrorCode(error) === "23503") throw new HeadInUseError();
        throw error;
      }
    },

    async createStructure(input) {
      try {
        const rows = await db
          .insert(feeStructures)
          .values({
            id: `fst_${randomUUID()}`,
            collegeId: input.collegeId,
            departmentId: input.departmentId,
            classId: input.classId,
            headId: input.headId,
            academicYear: input.academicYear,
            amount: input.amountPaise,
            dueOn: input.dueOn,
            installmentNo: input.installmentNo,
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        if (pgErrorCode(error) === "23505") throw new DuplicateStructureError();
        throw error;
      }
    },

    async getStructure(id) {
      const rows = await db.select().from(feeStructures).where(eq(feeStructures.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listStructuresForClass(classId, academicYear) {
      return db
        .select()
        .from(feeStructures)
        .where(and(eq(feeStructures.classId, classId), eq(feeStructures.academicYear, academicYear)))
        .orderBy(asc(feeStructures.installmentNo));
    },

    async createRun(input) {
      const rows = await db
        .insert(feeGenerationRuns)
        .values({
          id: `fgr_${randomUUID()}`,
          collegeId: input.collegeId,
          classId: input.classId,
          academicYear: input.academicYear,
          requestedBy: input.requestedBy,
        })
        .returning();
      return rows[0]!;
    },

    async getRun(id) {
      const rows = await db.select().from(feeGenerationRuns).where(eq(feeGenerationRuns.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async markRunning(id) {
      await db.update(feeGenerationRuns).set({ status: "running" }).where(eq(feeGenerationRuns.id, id));
    },

    async finishRun(id, outcome) {
      await db
        .update(feeGenerationRuns)
        .set({
          status: outcome.status,
          invoicesCreated: outcome.invoicesCreated,
          invoicesSkipped: outcome.invoicesSkipped,
          error: outcome.error,
          finishedAt: new Date(),
        })
        .where(eq(feeGenerationRuns.id, id));
    },

    async createInvoicesForStructures(structures, students) {
      if (structures.length === 0 || students.length === 0) {
        return { created: 0, skipped: 0 };
      }
      const values = structures.flatMap((structure) =>
        students.map((student) => ({
          id: `fiv_${randomUUID()}`,
          collegeId: structure.collegeId,
          departmentId: structure.departmentId,
          classId: structure.classId,
          sectionId: student.sectionId,
          studentId: student.studentId,
          structureId: structure.id,
          headId: structure.headId,
          academicYear: structure.academicYear,
          amount: structure.amount,
          dueOn: structure.dueOn,
        })),
      );
      const inserted = await db
        .insert(feeInvoices)
        .values(values)
        .onConflictDoNothing({ target: [feeInvoices.studentId, feeInvoices.structureId] })
        .returning({ id: feeInvoices.id });
      return { created: inserted.length, skipped: values.length - inserted.length };
    },

    async invoicesForStudent(studentId) {
      return db
        .select()
        .from(feeInvoices)
        .where(eq(feeInvoices.studentId, studentId))
        .orderBy(desc(feeInvoices.dueOn));
    },

    async invoicesForSection(sectionId, academicYear) {
      return db
        .select()
        .from(feeInvoices)
        .where(and(eq(feeInvoices.sectionId, sectionId), eq(feeInvoices.academicYear, academicYear)))
        .orderBy(desc(feeInvoices.dueOn));
    },

    async invoicesForCollege(collegeId, academicYear, statuses) {
      const conditions = [eq(feeInvoices.collegeId, collegeId), eq(feeInvoices.academicYear, academicYear)];
      if (statuses !== undefined && statuses.length > 0) {
        conditions.push(inArray(feeInvoices.status, statuses));
      }
      return db.select().from(feeInvoices).where(and(...conditions)).orderBy(asc(feeInvoices.dueOn));
    },

    async getInvoice(id) {
      const rows = await db.select().from(feeInvoices).where(eq(feeInvoices.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async paymentsForInvoice(invoiceId) {
      return db
        .select()
        .from(feePayments)
        .where(eq(feePayments.invoiceId, invoiceId))
        .orderBy(desc(feePayments.receivedAt));
    },

    async paymentsInRange(collegeId, fromIso, toIso) {
      const from = new Date(`${fromIso}T00:00:00.000Z`);
      const to = new Date(`${toIso}T23:59:59.999Z`);
      return db
        .select()
        .from(feePayments)
        .where(and(eq(feePayments.collegeId, collegeId), gte(feePayments.receivedAt, from), lte(feePayments.receivedAt, to)))
        .orderBy(desc(feePayments.receivedAt));
    },

    async recordPayment(input) {
      return db.transaction(async (tx) => {
        const invoiceRows = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, input.invoiceId)).for("update");
        const invoice = invoiceRows[0];
        if (invoice === undefined) throw new InvoiceNotFoundError();
        if (invoice.status === "waived") throw new InvoiceWaivedError();

        // The receipt counter: one row per college, incremented atomically —
        // a concurrent second transaction blocks on this row's lock until
        // the first commits, so receipt numbers are gap-free and unique
        // (the +1 step itself is the pure, unit-tested money.nextReceiptNo).
        await tx.insert(feeReceiptCounters).values({ collegeId: invoice.collegeId, lastIssued: 0 }).onConflictDoNothing();
        const counterRows = await tx
          .select()
          .from(feeReceiptCounters)
          .where(eq(feeReceiptCounters.collegeId, invoice.collegeId))
          .for("update");
        const receiptNo = nextReceiptNo(counterRows[0]!.lastIssued);
        await tx
          .update(feeReceiptCounters)
          .set({ lastIssued: receiptNo })
          .where(eq(feeReceiptCounters.collegeId, invoice.collegeId));

        const paymentRows = await tx
          .insert(feePayments)
          .values({
            id: `fpy_${randomUUID()}`,
            invoiceId: invoice.id,
            collegeId: invoice.collegeId,
            receiptNo,
            amount: input.amountPaise,
            mode: input.mode,
            ref: input.ref,
            receivedBy: input.receivedBy,
          })
          .returning();
        const payment = paymentRows[0]!;
        const updated = await recomputeStatus(tx as unknown as Db, invoice);
        return { payment, invoice: updated };
      });
    },

    async adjustmentsForInvoice(invoiceId) {
      return db
        .select()
        .from(feeAdjustments)
        .where(eq(feeAdjustments.invoiceId, invoiceId))
        .orderBy(desc(feeAdjustments.createdAt));
    },

    async addAdjustment(input) {
      return db.transaction(async (tx) => {
        const invoiceRows = await tx.select().from(feeInvoices).where(eq(feeInvoices.id, input.invoiceId)).for("update");
        const invoice = invoiceRows[0];
        if (invoice === undefined) throw new InvoiceNotFoundError();

        const rows = await tx
          .insert(feeAdjustments)
          .values({
            id: `fad_${randomUUID()}`,
            invoiceId: invoice.id,
            collegeId: invoice.collegeId,
            kind: input.kind,
            amount: input.amountPaise,
            reason: input.reason,
            actor: input.actor,
          })
          .returning();
        const adjustment = rows[0]!;
        const updated = await recomputeStatus(tx as unknown as Db, invoice);
        return { adjustment, invoice: updated };
      });
    },
  };
}
