import { z } from "zod";
import type { JobSpec, ModuleDefinition, RouteSpec } from "@vidya/platform";

export const MODULE_NAME = "fees";
export const TABLE_PREFIX = "fee_";

export const idSchema = z.string().min(1).max(64);
export const academicYearSchema = z.string().regex(/^\d{4}-\d{2}$/, 'academic year like "2026-27"');
/** Integer paise — never a float (house convention). */
export const paiseSchema = z.number().int().positive();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date like "2026-07-11"');
export const adjustmentKindSchema = z.enum(["scholarship", "fine", "refund", "waiver"]);
export const paymentModeSchema = z.enum(["cash", "upi", "card", "bank", "gateway"]);
export const invoiceStatusSchema = z.enum(["pending", "part", "paid", "waived"]);

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  requestId: z.string(),
});

const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const ADMIN_OR_ACCOUNTANT = {
  public: false as const,
  requirement: { rolesAnyOf: ["admin" as const, "accountant" as const] },
};
/** Read-only fee oversight: the principal is a college-wide viewer. */
const FEES_READERS = {
  public: false as const,
  requirement: { rolesAnyOf: ["admin" as const, "accountant" as const, "principal" as const] },
};
const STUDENT_ONLY = { public: false as const, requirement: { rolesAnyOf: ["student" as const] } };
const ANY_AUTHENTICATED = { public: false as const, requirement: {} };

export const feeHeadViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  name: z.string(),
});

export const feeStructureViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  departmentId: z.string(),
  classId: z.string(),
  headId: z.string(),
  headName: z.string(),
  academicYear: z.string(),
  amountPaise: z.number(),
  dueOn: z.string(),
  installmentNo: z.number(),
});

export const feeInvoiceViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  departmentId: z.string(),
  classId: z.string(),
  sectionId: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  admissionNo: z.string(),
  structureId: z.string(),
  headId: z.string(),
  headName: z.string(),
  academicYear: z.string(),
  amountPaise: z.number(),
  dueOn: z.string(),
  status: invoiceStatusSchema,
  paidPaise: z.number(),
  duesPaise: z.number(),
});

export const feePaymentViewSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  receiptNo: z.number(),
  amountPaise: z.number(),
  mode: paymentModeSchema,
  ref: z.string(),
  receivedBy: z.string(),
  receivedAt: z.string(),
});

export const feeAdjustmentViewSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  kind: adjustmentKindSchema,
  amountPaise: z.number(),
  reason: z.string(),
  actor: z.string(),
  createdAt: z.string(),
});

export const feeGenerationRunViewSchema = z.object({
  id: z.string(),
  collegeId: z.string(),
  classId: z.string(),
  academicYear: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  invoicesCreated: z.number(),
  invoicesSkipped: z.number(),
  error: z.string().nullable(),
});

const routes: RouteSpec[] = [
  {
    id: "fees.head-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/fees/heads",
    summary: "Create a fee head (admin) — e.g. Tuition, Library, Lab",
    tags: ["fees"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ collegeId: idSchema, name: z.string().trim().min(1).max(128) }) },
    audit: { action: "fees.head-created", resourceType: "fee-head" },
    responses: {
      201: { description: "Created", schema: feeHeadViewSchema },
      404: { description: "No such college", schema: problemSchema },
      409: { description: "Duplicate name", schema: problemSchema },
    },
  },
  {
    id: "fees.head-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/heads",
    summary: "List a college's fee heads",
    tags: ["fees"],
    auth: ADMIN_OR_ACCOUNTANT,
    request: { query: z.object({ collegeId: idSchema }) },
    responses: {
      200: { description: "Fee heads", schema: z.object({ heads: z.array(feeHeadViewSchema) }) },
    },
  },
  {
    id: "fees.head-delete",
    module: MODULE_NAME,
    method: "DELETE",
    path: "/api/v1/fees/heads/{headId}",
    summary: "Delete a fee head (admin)",
    description: "RESTRICT: heads referenced by a fee structure answer 409.",
    tags: ["fees"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ headId: idSchema }) },
    audit: { action: "fees.head-deleted", resourceType: "fee-head" },
    responses: {
      200: { description: "Deleted", schema: z.object({ ok: z.literal(true) }) },
      404: { description: "No such head", schema: problemSchema },
      409: { description: "Head still referenced by a structure", schema: problemSchema },
    },
  },
  {
    id: "fees.structure-create",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/fees/structures",
    summary: "Set a fee structure for a class (admin)",
    description: "One row per (class, head, academic year, installment). Invoices are generated separately (fees.invoices-generate) so a structure can be corrected before it goes out.",
    tags: ["fees"],
    auth: ADMIN_ONLY,
    request: {
      body: z.object({
        classId: idSchema,
        headId: idSchema,
        academicYear: academicYearSchema,
        amountPaise: paiseSchema,
        dueOn: dateSchema,
        installmentNo: z.coerce.number().int().min(1).max(12).default(1),
      }),
    },
    audit: { action: "fees.structure-created", resourceType: "fee-structure" },
    responses: {
      201: { description: "Created", schema: feeStructureViewSchema },
      404: { description: "No such class or head", schema: problemSchema },
      409: { description: "A structure already exists for this class/head/year/installment", schema: problemSchema },
    },
  },
  {
    id: "fees.structure-list",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/classes/{classId}/structures",
    summary: "List a class's fee structures for a year",
    tags: ["fees"],
    auth: ADMIN_OR_ACCOUNTANT,
    request: { params: z.object({ classId: idSchema }), query: z.object({ academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Structures", schema: z.object({ structures: z.array(feeStructureViewSchema) }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "fees.invoices-generate",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/fees/generate",
    summary: "Generate invoices for every structure of a class (admin) — runs in the worker",
    description: "Idempotent: students already invoiced for a structure are skipped, so re-running after enrolling more students only invoices the new ones. Poll fees.generate-get for progress.",
    tags: ["fees"],
    auth: ADMIN_ONLY,
    request: { body: z.object({ classId: idSchema, academicYear: academicYearSchema }) },
    audit: { action: "fees.generate-requested", resourceType: "fee-generation-run" },
    responses: {
      202: { description: "Accepted and enqueued", schema: z.object({ runId: z.string() }) },
      404: { description: "No such class", schema: problemSchema },
    },
  },
  {
    id: "fees.generate-get",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/generate/{runId}",
    summary: "Invoice-generation run status (admin) — for polling",
    tags: ["fees"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ runId: idSchema }) },
    responses: {
      200: { description: "Run state", schema: feeGenerationRunViewSchema },
      404: { description: "No such run", schema: problemSchema },
    },
  },
  {
    id: "fees.student-invoices",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/students/{studentId}/invoices",
    summary: "A student's invoices (scope-checked read)",
    tags: ["fees"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ studentId: idSchema }) },
    responses: {
      200: { description: "Invoices", schema: z.object({ invoices: z.array(feeInvoiceViewSchema) }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "fees.section-invoices",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/sections/{sectionId}/invoices",
    summary: "A section's invoices (scope-checked read)",
    tags: ["fees"],
    auth: ANY_AUTHENTICATED,
    request: { params: z.object({ sectionId: idSchema }), query: z.object({ academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Invoices", schema: z.object({ invoices: z.array(feeInvoiceViewSchema) }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such section", schema: problemSchema },
    },
  },
  {
    id: "fees.payment-record",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/fees/payments",
    summary: "Record a payment against an invoice (accountant/admin) — audited, monotonic receipt number",
    tags: ["fees"],
    auth: ADMIN_OR_ACCOUNTANT,
    request: {
      body: z.object({
        invoiceId: idSchema,
        amountPaise: paiseSchema,
        mode: paymentModeSchema,
        ref: z.string().trim().max(128).default(""),
      }),
    },
    audit: { action: "fees.payment-recorded", resourceType: "fee-payment" },
    responses: {
      201: {
        description: "Recorded",
        schema: z.object({ payment: feePaymentViewSchema, invoice: feeInvoiceViewSchema }),
      },
      404: { description: "No such invoice", schema: problemSchema },
      409: { description: "Invoice is waived — no further payments accepted", schema: problemSchema },
    },
  },
  {
    id: "fees.adjustment-add",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/fees/adjustments",
    summary: "Add an adjustment — scholarship, fine, refund or waiver (accountant/admin)",
    tags: ["fees"],
    auth: ADMIN_OR_ACCOUNTANT,
    request: {
      body: z.object({
        invoiceId: idSchema,
        kind: adjustmentKindSchema,
        amountPaise: paiseSchema,
        reason: z.string().trim().max(256).default(""),
      }),
    },
    audit: { action: "fees.adjustment-added", resourceType: "fee-adjustment" },
    responses: {
      201: {
        description: "Recorded",
        schema: z.object({ adjustment: feeAdjustmentViewSchema, invoice: feeInvoiceViewSchema }),
      },
      404: { description: "No such invoice", schema: problemSchema },
    },
  },
  {
    id: "fees.my-fees",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/my-fees",
    summary: "The signed-in student's own fee status (self via the identity link)",
    tags: ["fees"],
    auth: STUDENT_ONLY,
    responses: {
      200: {
        description: "Invoices with payment/adjustment history",
        schema: z.object({
          invoices: z.array(
            feeInvoiceViewSchema.extend({
              payments: z.array(feePaymentViewSchema),
              adjustments: z.array(feeAdjustmentViewSchema),
            }),
          ),
        }),
      },
      404: { description: "This sign-in is not linked to a student record", schema: problemSchema },
    },
  },
  {
    id: "fees.collection-summary",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/collections/summary",
    summary: "Collection totals by mode over a date range (accountant/admin/principal)",
    tags: ["fees"],
    auth: FEES_READERS,
    request: {
      query: z.object({ collegeId: idSchema, from: dateSchema, to: dateSchema }),
    },
    responses: {
      200: {
        description: "Totals",
        schema: z.object({
          from: z.string(),
          to: z.string(),
          totalPaise: z.number(),
          byMode: z.array(z.object({ mode: paymentModeSchema, totalPaise: z.number(), count: z.number() })),
        }),
      },
    },
  },
  {
    id: "fees.defaulters",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/fees/defaulters",
    summary: "Students with outstanding dues (accountant/admin/principal)",
    tags: ["fees"],
    auth: FEES_READERS,
    request: { query: z.object({ collegeId: idSchema, academicYear: academicYearSchema }) },
    responses: {
      200: { description: "Outstanding invoices", schema: z.object({ defaulters: z.array(feeInvoiceViewSchema) }) },
    },
  },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const INVOICE_GENERATE_JOB_NAME = "invoice-generate";
export const invoiceGeneratePayloadSchema = z.object({
  runId: idSchema,
});

const jobs: JobSpec[] = [
  {
    name: INVOICE_GENERATE_JOB_NAME,
    module: MODULE_NAME,
    summary: "Generates one invoice per (enrolled student × structure) for a class/year; idempotent.",
    payloadSchema: invoiceGeneratePayloadSchema,
  },
];

export const feesModuleDefinition: ModuleDefinition = {
  name: MODULE_NAME,
  tablePrefix: TABLE_PREFIX,
  migrationsDir: "migrations",
  routes,
  jobs,
};
