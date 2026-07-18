import {
  RoleRequirementPolicy,
  createDb,
  createLogger,
  createMetrics,
  createObjectStorage,
  createRedis,
  defineRoute,
  loadConfig,
  type BoundRouteHandler,
  type OrgDirectory,
  type RouteDependencies,
  type RouteSpec,
} from "@vidya/platform";
import { createSystemModule } from "@vidya/module-system";
import { createIdentityCore, createIdentityModule } from "@vidya/module-identity";
import { createPeopleModule } from "@vidya/module-people";
import { createAcademicsModule } from "@vidya/module-academics";
import { createTimetableModule } from "@vidya/module-timetable";
import { INVOICE_GENERATE_JOB_NAME, createFeesModule } from "@vidya/module-fees";
import { createNoticesModule } from "@vidya/module-notices";
import { createResultsModule } from "@vidya/module-results";
import { createExamsModule } from "@vidya/module-exams";
import { createLeaveModule } from "@vidya/module-leave";
import { createSyllabusModule } from "@vidya/module-syllabus";

/**
 * DEMO DATA SEEDER — a self-contained, non-production pilot dataset.
 *
 * This does NOT reach into repositories or bypass authorization. It composes
 * the REAL modules and drives them through the same defineRoute pipeline the
 * web app uses: every write is authenticated with a real session cookie, is
 * gated by #2's ScopeChecker, and is audited. A class_teacher records the
 * attendance; each subject teacher enters their own marks; the principal and
 * HoD hold real college-/department-scoped grants. If a step would be denied
 * by scope, the seed fails loudly — because that is exactly what the product
 * does. The result is a database a reviewer can log into, one role at a time,
 * and watch the permission mirror behave.
 *
 * SAFETY: refuses unless VIDYA_ALLOW_DEMO_SEED=true, and never runs when
 * NODE_ENV=production. It owns a college with the fixed code "DEMO" and a
 * dedicated demo admin; it is idempotent by fixed org codes (a second run is
 * detected and short-circuits rather than duplicating the tree).
 *
 *   VIDYA_ALLOW_DEMO_SEED=true tsx scripts/seed-demo.ts
 */

const YEAR = "2026-27";
const COLLEGE = { name: "Sunrise Institute of Technology", code: "DEMO" };
const ADMIN = { username: "demo-admin", displayName: "Demo Administrator", password: "demo-admin-pass-2026!" };
const STAFF_PASSWORD = "demo-staff-pass-2026!";
const TEACHER_PASSWORD = "demo-teacher-pass-2026!";
const STUDENT_PASSWORD = "demo-student-pass-2026!";
const ACCOUNTANT_PASSWORD = "demo-accountant-pass-2026!";

type Slot = { studentId: string; status: "present" | "absent" | "late" | "excused" };

/** Per-subject demo syllabi (units → topics), keyed by subject code. The seed
 *  authors these for each class's first subject and marks Unit 1 taught, so the
 *  portal shows a real, partial (derived) coverage. Generic fallback below. */
const SYLLABI: Record<string, { title: string; topics: string[] }[]> = {
  DS: [
    { title: "Unit 1 — Foundations", topics: ["Arrays & complexity", "Linked lists", "Stacks & queues"] },
    { title: "Unit 2 — Trees & Graphs", topics: ["Binary trees & BSTs", "Heaps", "Graph traversal (BFS/DFS)"] },
  ],
  OOP: [
    { title: "Unit 1 — Objects & Classes", topics: ["Classes & objects", "Constructors & destructors", "Encapsulation"] },
    { title: "Unit 2 — Inheritance & Polymorphism", topics: ["Inheritance", "Virtual functions", "Operator overloading"] },
  ],
  AI: [
    { title: "Unit 1 — Search", topics: ["Problem solving as search", "Uninformed search", "Heuristic search (A*)"] },
    { title: "Unit 2 — Knowledge & Learning", topics: ["Propositional logic", "Bayesian reasoning", "Intro to machine learning"] },
  ],
  ELEC: [
    { title: "Unit 1 — Semiconductors", topics: ["PN junction diode", "Rectifiers", "Zener regulation"] },
    { title: "Unit 2 — Transistors", topics: ["BJT fundamentals", "Biasing", "Small-signal amplifiers"] },
  ],
  DIG: [
    { title: "Unit 1 — Combinational Logic", topics: ["Number systems", "Boolean algebra", "Multiplexers & decoders"] },
    { title: "Unit 2 — Sequential Logic", topics: ["Flip-flops", "Counters", "Registers"] },
  ],
  ACC: [
    { title: "Unit 1 — Fundamentals", topics: ["Accounting concepts", "Journal & ledger", "Trial balance"] },
    { title: "Unit 2 — Final Accounts", topics: ["Trading account", "Profit & loss account", "Balance sheet"] },
  ],
};

function syllabusFor(code: string, name: string): { title: string; topics: string[] }[] {
  return (
    SYLLABI[code] ?? [
      { title: `Unit 1 — Introduction to ${name}`, topics: ["Core concepts", "Key principles", "Foundational methods"] },
      { title: "Unit 2 — Applications", topics: ["Applied techniques", "Case studies", "Assessment preparation"] },
    ]
  );
}

interface Credential {
  role: string;
  username: string;
  password: string;
  scope: string;
}

/** The demo tree, as data. The seed walks it to build everything: one section
 *  per class (no empty sections), unique staff usernames throughout. */
const DEPARTMENTS = [
  {
    code: "CSE",
    name: "Computer Science",
    hod: { username: "demo-hod-cse", displayName: "Dr. Radhika Menon" },
    classes: [
      {
        code: "FYCS",
        name: "FY BSc Computer Science",
        sections: ["A", "B", "C"],
        rosterSection: "A", // where students enrol and records are kept
        classTeacher: { username: "demo-ct-fycs", displayName: "Sunil Kulkarni" },
        subjects: [
          { code: "DS", name: "Data Structures", teacher: { username: "demo-teacher-ds", displayName: "Anita Desai" } },
          { code: "MTH", name: "Discrete Mathematics", teacher: { username: "demo-teacher-mth", displayName: "Vikram Rao" } },
          { code: "DBMS", name: "Database Systems", teacher: { username: "demo-teacher-dbms", displayName: "Priya Nair" } },
        ],
        students: [
          "Aarav Sharma", "Diya Patel", "Kabir Singh", "Meera Iyer",
          "Rohan Gupta", "Saanvi Reddy", "Ishaan Khan", "Ananya Bose",
          "Vivaan Joshi", "Aditi Rao", "Arnav Mehta", "Kavya Nair",
          "Reyansh Shah", "Myra Kapoor",
        ],
        sectionB: ["Devansh Iyer", "Kritika Menon", "Yash Kulkarni"],
        sectionC: ["Naina Bhatt", "Aryan Kapoor"],
      },
      {
        code: "SYCS",
        name: "SY BSc Computer Science",
        sections: ["A", "B", "C"],
        rosterSection: "A",
        classTeacher: { username: "demo-ct-sycs", displayName: "Deepa Kulkarni" },
        subjects: [
          { code: "OOP", name: "Object-Oriented Programming", teacher: { username: "demo-teacher-sycs-oop", displayName: "Rajesh Mhatre" } },
          { code: "OS", name: "Operating Systems", teacher: { username: "demo-teacher-sycs-os", displayName: "Sunita Kale" } },
        ],
        students: [
          "Aryan Deshmukh", "Isha Kulkarni", "Sai Pawar", "Tanvi Joshi",
          "Harsh Patil", "Sneha Bhosale", "Aditya Shinde", "Riya Gaikwad",
          "Karan Jadhav", "Pooja More", "Nikhil Chavan", "Sanika Sawant",
        ],
        sectionB: ["Rutuja Deshmukh", "Abhishek Naik", "Simran Kaur"],
        sectionC: ["Prathamesh Jadhav", "Komal Shinde"],
      },
      {
        code: "TYCS",
        name: "TY BSc Computer Science",
        sections: ["A", "B", "C"],
        rosterSection: "A",
        classTeacher: { username: "demo-ct-tycs", displayName: "Prakash Gokhale" },
        subjects: [
          { code: "AI", name: "Artificial Intelligence", teacher: { username: "demo-teacher-tycs-ai", displayName: "Manish Kulkarni" } },
          { code: "CN", name: "Computer Networks", teacher: { username: "demo-teacher-tycs-cn", displayName: "Vaishali Rane" } },
        ],
        students: [
          "Omkar Salunkhe", "Shruti Mane", "Tejas Nikam", "Prachi Wagh",
          "Rahul Kadam", "Manasi Bhagat", "Yogesh Thorat", "Divya Pandit",
          "Sameer Dhumal", "Gauri Lokhande",
        ],
        sectionB: ["Vedant Kulkarni", "Anushka Patil", "Rushikesh More"],
        sectionC: ["Sayali Gaikwad", "Nilesh Sawant"],
      },
    ],
  },
  {
    code: "ECE",
    name: "Electronics & Communication",
    hod: { username: "demo-hod-ece", displayName: "Dr. Farhan Qureshi" },
    classes: [
      {
        code: "FYEC",
        name: "FY BSc Electronics",
        sections: ["A", "B", "C"],
        rosterSection: "A",
        classTeacher: { username: "demo-ct-fyec", displayName: "Latha Krishnan" },
        subjects: [
          { code: "ELEC", name: "Basic Electronics", teacher: { username: "demo-teacher-elec", displayName: "Deepak Joshi" } },
          { code: "SIG", name: "Signals & Systems", teacher: { username: "demo-teacher-fyec-sig", displayName: "Anil Kamble" } },
        ],
        students: ["Tara Mehta", "Yash Chauhan", "Nisha Pillai", "Arjun Nair", "Zara Sheikh", "Dev Malhotra", "Ira Sinha", "Neel Verma", "Riya Das", "Om Bhat"],
        sectionB: ["Advait Rao", "Shreya Kamble", "Parth Malhotra"],
        sectionC: ["Isha Verma", "Kunal Sinha"],
      },
      {
        code: "SYEC",
        name: "SY BSc Electronics",
        sections: ["A", "B", "C"],
        rosterSection: "A",
        classTeacher: { username: "demo-ct-syec", displayName: "Meena Iyer" },
        subjects: [
          { code: "DIG", name: "Digital Circuits", teacher: { username: "demo-teacher-syec-dig", displayName: "Suresh Naik" } },
        ],
        students: ["Aditi Menon", "Rohit Bhandari", "Sana Shaikh", "Varun Rao", "Anjali Kulkarni", "Farhan Ali", "Pooja Deshpande", "Kiran Patil"],
        sectionB: ["Ritesh Naik", "Payal Shaikh", "Gaurav Bhandari"],
        sectionC: ["Snehal Deshpande", "Amit Patil"],
      },
    ],
  },
  {
    code: "COM",
    name: "Commerce",
    hod: { username: "demo-hod-com", displayName: "Dr. Sulbha Deshpande" },
    classes: [
      {
        code: "FYBCOM",
        name: "FY BCom",
        sections: ["A", "B", "C"],
        rosterSection: "A",
        classTeacher: { username: "demo-ct-fybcom", displayName: "Nandini Rao" },
        subjects: [
          { code: "ACC", name: "Financial Accounting", teacher: { username: "demo-teacher-fybcom-acc", displayName: "Girish Kulkarni" } },
          { code: "ECO", name: "Business Economics", teacher: { username: "demo-teacher-fybcom-eco", displayName: "Sneha Kulkarni" } },
        ],
        students: [
          "Ritika Agarwal", "Mohit Jain", "Sakshi Gupta", "Aman Verma",
          "Neha Chopra", "Rahul Bansal", "Priyanka Singh", "Karan Malhotra",
          "Ayesha Khan", "Siddharth Rao", "Tanya Mehta", "Vikas Sharma",
        ],
        sectionB: ["Ankita Jain", "Rohan Bansal", "Shweta Chopra"],
        sectionC: ["Nikhil Rao", "Divya Sharma"],
      },
    ],
  },
] as const;

function buildStack() {
  const config = loadConfig();
  const logger = createLogger({ level: "warn", serviceName: "vidya-seed-demo" });
  const metrics = createMetrics({ serviceName: "vidya-seed-demo", defaultMetrics: false });
  const { pool, db } = createDb({
    url: config.database.url,
    poolMax: 4,
    logger,
    applicationName: "vidya-seed-demo",
  });
  const redis = createRedis({ url: config.redis.url, logger, connectionName: "vidya-seed-demo" });
  const objectStorage = createObjectStorage(config.s3);

  const system = createSystemModule({
    db,
    metrics,
    serviceVersion: "seed-demo",
    isDraining: () => false,
    infrastructureChecks: [],
  });
  const core = createIdentityCore({
    redis,
    session: {
      ttlHours: config.identity.session.ttlHours,
      idleMinutes: config.identity.session.idleMinutes,
    },
  });
  const orgDirectoryRef: { current: OrgDirectory | null } = { current: null };
  const identity = createIdentityModule({
    db,
    redis,
    metrics,
    audit: system.service.audit,
    core,
    config: config.identity,
    orgDirectory: () => orgDirectoryRef.current,
  });
  const people = createPeopleModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    identityGrants: identity.service.derivedGrants,
    storage: { client: objectStorage, bucket: config.s3.bucket },
    enqueueImport: async () => {
      /* the demo does not use bulk CSV import */
    },
  });
  orgDirectoryRef.current = people.service.orgDirectory;
  const academics = createAcademicsModule({
    db,
    metrics,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    peopleDirectory: people.service.directory,
    readAudit: async (resourceType, resourceId, limit) =>
      (await system.service.readAuditEventsForResource(resourceType, resourceId, limit)).map((row) => ({
        action: row.action,
        actorId: row.actorId,
        occurredAt: row.occurredAt,
        details: row.details,
      })),
  });

  const routeDeps: RouteDependencies = {
    logger,
    authenticator: identity.service.authenticator,
    accessPolicy: new RoleRequirementPolicy(),
    auditLogger: system.service.audit,
    metrics,
  };
  const specs = new Map<string, RouteSpec>();
  const handlers: Record<string, BoundRouteHandler> = {};
  const timetable = createTimetableModule({
    db,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  // --- fees --- (the seed has no worker: generate runs its processor inline)
  const fees: ReturnType<typeof createFeesModule> = createFeesModule({
    db,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    peopleDirectory: people.service.directory,
    enqueueGenerate: async (payload) => {
      await fees.jobProcessors[INVOICE_GENERATE_JOB_NAME]!(payload, { logger, jobId: "seed-inline", attempt: 1 });
    },
  });

  // --- notices ---
  const notices = createNoticesModule({
    db,
    audit: system.service.audit,
    peopleDirectory: people.service.directory,
  });

  // --- results ---
  const results = createResultsModule({
    db,
    audit: system.service.audit,
    peopleDirectory: people.service.directory,
    marksReadModel: academics.service.readModel,
  });

  // --- exams ---
  const exams = createExamsModule({
    db,
    audit: system.service.audit,
    peopleDirectory: people.service.directory,
    timetableRead: timetable.service.readModel,
  });

  // --- leave --- (no jobs — approvals only)
  const leave = createLeaveModule({
    db,
    audit: system.service.audit,
    peopleDirectory: people.service.directory,
  });

  // --- syllabus --- (units + topics + coverage; no jobs, no storage)
  const syllabus = createSyllabusModule({
    db,
    audit: system.service.audit,
    scopeChecker: core.scopeChecker,
    peopleDirectory: people.service.directory,
  });

  for (const module of [identity, people, academics, timetable, fees, notices, results, exams, leave, syllabus]) {
    for (const route of module.definition.routes) {
      specs.set(route.id, route);
      handlers[route.id] = defineRoute(route, module.handlers[route.id]!, routeDeps);
    }
  }

  async function call(
    routeId: string,
    options: { body?: unknown; cookie?: string; params?: Record<string, string>; query?: Record<string, string> } = {},
  ): Promise<Response> {
    const route = specs.get(routeId);
    if (route === undefined) throw new Error(`unknown route ${routeId}`);
    const headers: Record<string, string> = { "x-forwarded-for": "127.0.0.1" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.cookie !== undefined) headers.cookie = options.cookie;
    const query = new URLSearchParams(options.query ?? {}).toString();
    const request = new Request(`http://localhost${route.path}${query === "" ? "" : `?${query}`}`, {
      method: route.method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    return handlers[routeId]!(request, { params: Promise.resolve(options.params ?? {}) });
  }

  async function close(): Promise<void> {
    objectStorage.destroy();
    redis.disconnect();
    await pool.end();
  }

  return { config, call, identity, people, system, pool, close };
}

type Stack = ReturnType<typeof buildStack>;

/** Reads a JSON body, throwing with the raw payload if the status isn't expected. */
async function expectJson<T>(res: Response, allowed: number[], label: string): Promise<T> {
  if (!allowed.includes(res.status)) {
    const text = await res.text();
    throw new Error(`${label}: expected ${allowed.join("/")}, got ${res.status} — ${text}`);
  }
  return (await res.json()) as T;
}

function cookieFrom(res: Response): string {
  const token = /vidya_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return `vidya_session=${token}`;
}

async function main(): Promise<void> {
  if (process.env.VIDYA_ALLOW_DEMO_SEED !== "true") {
    console.error(
      "refused: demo seeding is off. Set VIDYA_ALLOW_DEMO_SEED=true to run it against a\n" +
        "non-production database. It creates demo accounts with well-known passwords.",
    );
    process.exit(2);
  }

  const stack = buildStack();
  const { call, config } = stack;

  if (config.env === "production") {
    console.error("refused: NODE_ENV=production. The demo seed is for pilots and evaluation only.");
    await stack.close();
    process.exit(2);
  }

  try {
    const credentials: Credential[] = [];
    let portalStudentId: string | null = null;
    let portalStudentName = "";
    let feesClassId: string | null = null;
    let feesSectionId: string | null = null;
    let leaveTeacherCookie: string | null = null;
    let leaveHodCookie: string | null = null;

    // 1) The demo college and its dedicated admin (idempotent by code).
    const college = await stack.people.service.bootstrapCollege({ name: COLLEGE.name, code: COLLEGE.code });
    const collegeId = college.collegeId;
    console.log(`college: ${COLLEGE.name} (${collegeId})${college.created ? " — created" : " — exists"}`);

    try {
      await stack.identity.service.bootstrapAdmin({
        username: ADMIN.username,
        displayName: ADMIN.displayName,
        password: ADMIN.password,
        collegeId,
      });
      console.log(`admin: ${ADMIN.username} — created`);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("bootstrap refused"))) throw error;
      console.log(`admin: bootstrap refused (an admin already exists) — signing in as ${ADMIN.username}`);
    }
    const adminLogin = await call("identity.login", { body: { username: ADMIN.username, password: ADMIN.password } });
    if (adminLogin.status !== 200) {
      throw new Error(
        "cannot sign in as the demo admin. This database already has a different admin.\n" +
          "The demo seed expects a fresh, non-production database (see docs/getting-started.md).",
      );
    }
    const adminCookie = cookieFrom(adminLogin);
    credentials.push({ role: "admin", username: ADMIN.username, password: ADMIN.password, scope: "college-wide" });

    // The college's period template (timetable spine): P1–P6.
    const periodsSet = await call("timetable.periods-set", {
      cookie: adminCookie,
      params: { collegeId },
      body: {
        periods: [
          { periodNo: 1, starts: "09:00", ends: "09:50" },
          { periodNo: 2, starts: "10:00", ends: "10:50" },
          { periodNo: 3, starts: "11:00", ends: "11:50" },
          { periodNo: 4, starts: "12:00", ends: "12:50" },
          { periodNo: 5, starts: "14:00", ends: "14:50" },
          { periodNo: 6, starts: "15:00", ends: "15:50" },
        ],
      },
    });
    if (periodsSet.status !== 200) throw new Error(`periods-set: ${periodsSet.status}`);

    /** Creates an identity user with an active password (create → reset → active). */
    async function provisionUser(
      username: string,
      displayName: string,
      roles: string[],
      password: string,
    ): Promise<string> {
      const created = await call("identity.user-create", {
        cookie: adminCookie,
        body: { username, displayName, collegeId, temporaryPassword: "temporary-pass-123", roles },
      });
      const { id } = await expectJson<{ id: string }>(created, [201], `user-create ${username}`);
      const reset = await call("identity.password-reset-init", { cookie: adminCookie, params: { userId: id } });
      const { token } = await expectJson<{ token: string }>(reset, [200, 201], `reset-init ${username}`);
      const confirm = await call("identity.password-reset-confirm", { body: { token, newPassword: password } });
      if (confirm.status !== 200) throw new Error(`reset-confirm ${username}: ${confirm.status}`);
      return id;
    }

    /** Fees demo data (6b) — idempotent, so it can run as an increment on an
     * already-seeded database: heads/structures tolerate 409 and payments are
     * guarded on untouched invoices. */
    async function seedFeesBlock(target: { classId: string; sectionId: string; portalStudentId: string | null }): Promise<void> {
      const accCreated = await call("identity.user-create", {
        cookie: adminCookie,
        body: { username: "demo-accountant", displayName: "Kiran Rao", collegeId, temporaryPassword: "temporary-pass-123", roles: ["accountant"] },
      });
      // null = the user AND grant already exist (fully idempotent re-run).
      let grantNeededFor: string | null = null;
      if (accCreated.status === 201) {
        grantNeededFor = ((await accCreated.json()) as { id: string }).id;
        const reset = await call("identity.password-reset-init", { cookie: adminCookie, params: { userId: grantNeededFor } });
        const { token } = await expectJson<{ token: string }>(reset, [200, 201], "reset-init demo-accountant");
        const confirm = await call("identity.password-reset-confirm", { body: { token, newPassword: ACCOUNTANT_PASSWORD } });
        if (confirm.status !== 200) throw new Error(`reset-confirm demo-accountant: ${confirm.status}`);
      } else if (accCreated.status === 409) {
        // A prior (possibly failed) run created the account — find it so the
        // grant can still be ensured.
        const users = await expectJson<{ users: { id: string; username: string; grants: { role: string }[] }[] }>(
          await call("identity.user-list", { cookie: adminCookie, query: { collegeId, limit: "200" } }),
          [200],
          "user list (accountant lookup)",
        );
        const existing = users.users.find((user) => user.username === "demo-accountant");
        if (existing === undefined) throw new Error("demo-accountant exists (409) but is absent from the user list");
        if (!existing.grants.some((grant) => grant.role === "accountant")) grantNeededFor = existing.id;
      } else {
        throw new Error(`user-create demo-accountant: ${accCreated.status}`);
      }
      if (grantNeededFor !== null) {
        await expectJson(
          await call("identity.grant-add", {
            cookie: adminCookie,
            params: { userId: grantNeededFor },
            body: { role: "accountant", collegeId },
          }),
          [201],
          "accountant grant",
        );
      }

      async function ensureHead(name: string): Promise<string> {
        const created = await call("fees.head-create", { cookie: adminCookie, body: { collegeId, name } });
        if (created.status === 201) return ((await created.json()) as { id: string }).id;
        if (created.status !== 409) throw new Error(`fee head ${name}: ${created.status}`);
        const list = await expectJson<{ heads: { id: string; name: string }[] }>(
          await call("fees.head-list", { cookie: adminCookie, query: { collegeId } }),
          [200],
          "fee head list",
        );
        const head = list.heads.find((h) => h.name === name);
        if (head === undefined) throw new Error(`fee head ${name}: 409 but absent from the list`);
        return head.id;
      }
      const tuitionHeadId = await ensureHead("Tuition");
      const libraryHeadId = await ensureHead("Library");

      // Tuition installment 1 fell due before the demo anchor → overdue rows exist.
      await expectJson(
        await call("fees.structure-create", {
          cookie: adminCookie,
          body: { classId: target.classId, headId: tuitionHeadId, academicYear: YEAR, amountPaise: 5_000_000, dueOn: "2026-07-01", installmentNo: 1 },
        }),
        [201, 409],
        "structure tuition-1",
      );
      await expectJson(
        await call("fees.structure-create", {
          cookie: adminCookie,
          body: { classId: target.classId, headId: libraryHeadId, academicYear: YEAR, amountPaise: 200_000, dueOn: "2026-09-01", installmentNo: 1 },
        }),
        [201, 409],
        "structure library-1",
      );

      // Generate invoices — the seed stack runs the worker's processor inline;
      // the job itself is idempotent (existing student×structure pairs skip).
      const runRes = await expectJson<{ runId: string }>(
        await call("fees.invoices-generate", { cookie: adminCookie, body: { classId: target.classId, academicYear: YEAR } }),
        [202],
        "invoice generation",
      );
      const run = await expectJson<{ status: string; invoicesCreated: number; invoicesSkipped: number; error: string | null }>(
        await call("fees.generate-get", { cookie: adminCookie, params: { runId: runRes.runId } }),
        [200],
        "generation run state",
      );
      if (run.status !== "completed") throw new Error(`invoice generation ${run.status}: ${run.error ?? "?"}`);
      console.log(`  fees: invoices generated — created ${run.invoicesCreated}, skipped ${run.invoicesSkipped}`);

      // Payments at the counter (accountant session) — guarded on untouched
      // invoices so a re-run never double-pays.
      const accountantCookie = await login(stack, "demo-accountant", ACCOUNTANT_PASSWORD);
      const sectionInvoices = await expectJson<{
        invoices: { id: string; studentId: string; headId: string; status: string; amountPaise: number; paidPaise: number; duesPaise: number }[];
      }>(
        await call("fees.section-invoices", {
          cookie: accountantCookie,
          params: { sectionId: target.sectionId },
          query: { academicYear: YEAR },
        }),
        [200],
        "section invoices",
      );
      const tuitionOf = (studentId: string) =>
        sectionInvoices.invoices.find((inv) => inv.studentId === studentId && inv.headId === tuitionHeadId);
      const byStudent = [...new Set(sectionInvoices.invoices.map((inv) => inv.studentId))];
      const portalTuition = target.portalStudentId !== null ? tuitionOf(target.portalStudentId) : undefined;
      if (portalTuition !== undefined && portalTuition.status === "pending" && portalTuition.paidPaise === 0) {
        await expectJson(
          await call("fees.payment-record", {
            cookie: accountantCookie,
            body: { invoiceId: portalTuition.id, amountPaise: 2_000_000, mode: "upi", ref: "UPI-DEMO-001" },
          }),
          [201],
          "part payment (portal student)",
        );
      }
      const fullPayer = byStudent.find((id) => id !== target.portalStudentId);
      const fullTuition = fullPayer !== undefined ? tuitionOf(fullPayer) : undefined;
      if (fullTuition !== undefined && fullTuition.status === "pending" && fullTuition.paidPaise === 0) {
        await expectJson(
          await call("fees.payment-record", {
            cookie: accountantCookie,
            body: { invoiceId: fullTuition.id, amountPaise: fullTuition.duesPaise, mode: "cash" },
          }),
          [201],
          "full payment",
        );
      }
      const strugglerId = byStudent.find((id) => id !== target.portalStudentId && id !== fullPayer);
      const strugglerTuition = strugglerId !== undefined ? tuitionOf(strugglerId) : undefined;
      if (strugglerTuition !== undefined && strugglerTuition.duesPaise === strugglerTuition.amountPaise) {
        await expectJson(
          await call("fees.adjustment-add", {
            cookie: accountantCookie,
            body: { invoiceId: strugglerTuition.id, kind: "scholarship", amountPaise: 1_000_000, reason: "Merit scholarship 2026" },
          }),
          [201],
          "scholarship adjustment",
        );
      }
      console.log("  fees: counter payments and a scholarship in place");
    }

    /** Notices demo data (6c) — idempotent: skips when the board already has entries. */
    async function seedNoticesBlock(classId: string): Promise<void> {
      const existing = await expectJson<{ notices: unknown[] }>(
        await call("notices.list", { cookie: adminCookie, query: { collegeId } }),
        [200],
        "notices list",
      );
      if (existing.notices.length > 0) {
        console.log("  notices: board already has entries — skipping");
        return;
      }
      const board: { audience: string; title: string; body: string; kind?: string; eventDate?: string }[] = [
        {
          audience: "college",
          title: "Odd-semester timetable is live",
          body: "The 2026-27 odd-semester timetable is published. Check your section's schedule under Timetable; report clashes to the office by Friday.",
        },
        {
          audience: "students",
          title: "Fee counter hours extended",
          body: "The fee counter stays open until 5 PM through July for tuition installment 1. Carry your admission number; UPI and card are accepted.",
        },
        {
          audience: `class:${classId}`,
          title: "Unit Test 1 syllabus posted",
          body: "Unit Test 1 covers everything taught through the first week of July. Syllabus details are with your subject teachers.",
        },
        // --- academic calendar: dated entries (holiday / exam / event) ---
        { audience: "college", kind: "exam", eventDate: "2026-07-22", title: "Unit Test 1 begins", body: "Unit Test 1 for all FY/SY classes. Timetable on the noticeboard; report to your rooms 10 minutes early." },
        { audience: "college", kind: "holiday", eventDate: "2026-08-15", title: "Independence Day", body: "The college remains closed. Flag hoisting at 8:00 AM in the main quadrangle." },
        { audience: "college", kind: "event", eventDate: "2026-08-28", title: "Annual Sports Day", body: "Track and field events at the college ground. Register with your class teacher by 24 August." },
        { audience: "college", kind: "holiday", eventDate: "2026-09-14", title: "Ganesh Chaturthi", body: "College closed for the festival." },
        { audience: "college", kind: "exam", eventDate: "2026-10-06", title: "Term 1 examinations", body: "End-of-term examinations begin. Hall tickets are available under Exams." },
      ];
      for (const notice of board) {
        await expectJson(
          await call("notices.create", { cookie: adminCookie, body: { collegeId, ...notice } }),
          [201],
          `notice "${notice.title}"`,
        );
      }
      console.log(`  notices: ${board.length} posted (college / students / class)`);
    }

    /** Results demo data (6d) — idempotent: scale reused by name, credits are a
     * full replace, publish tolerates 409. Publishes Term 1 for the demo class
     * so the portal shows a grade card; other classes stay withheld. */
    async function seedResultsBlock(classId: string): Promise<void> {
      const scaleList = await expectJson<{ scales: { id: string; name: string }[] }>(
        await call("results.scale-list", { cookie: adminCookie, query: { collegeId } }),
        [200],
        "scale list",
      );
      let scaleId = scaleList.scales.find((scale) => scale.name === "10-point")?.id;
      if (scaleId === undefined) {
        const created = await expectJson<{ id: string }>(
          await call("results.scale-create", {
            cookie: adminCookie,
            body: {
              collegeId,
              name: "10-point",
              bands: [
                { minPct: 90, grade: "A+", points: 10 },
                { minPct: 80, grade: "A", points: 9 },
                { minPct: 70, grade: "B+", points: 8 },
                { minPct: 60, grade: "B", points: 7 },
                { minPct: 50, grade: "C", points: 6 },
                { minPct: 40, grade: "D", points: 5 },
                { minPct: 0, grade: "F", points: 0 },
              ],
            },
          }),
          [201],
          "scale create",
        );
        scaleId = created.id;
      }

      // Credits for the demo class's subjects: 4 for the first, 3 for the rest.
      const tree = await expectJson<{
        departments: { classes: { id: string }[]; subjects: { id: string; name: string }[] }[];
      }>(await call("people.college-tree", { cookie: adminCookie, params: { collegeId } }), [200], "tree for credits");
      const department = tree.departments.find((dep) => dep.classes.some((cls) => cls.id === classId));
      const subjects = department?.subjects ?? [];
      if (subjects.length === 0) {
        console.log("  results: no subjects for the demo class — skipping");
        return;
      }
      await expectJson(
        await call("results.credits-set", {
          cookie: adminCookie,
          body: {
            classId,
            academicYear: YEAR,
            entries: subjects.map((subject, index) => ({ subjectId: subject.id, credits: index === 0 ? 4 : 3 })),
          },
        }),
        [200],
        "credits set",
      );
      const published = await call("results.publish", {
        cookie: adminCookie,
        body: { classId, academicYear: YEAR, term: "Term 1", scaleId },
      });
      if (published.status !== 201 && published.status !== 409) {
        throw new Error(`publish Term 1: ${published.status} — ${await published.text()}`);
      }
      console.log(`  results: 10-point scale, credits for ${subjects.length} subjects, Term 1 ${published.status === 201 ? "published" : "already published"}`);
    }

    /** Exams demo data (E4) — idempotent: series reused by name via the list,
     * slots tolerate 409 (subject already scheduled in the series). Schedules a
     * "Midterm" paper per subject on consecutive weekday mornings so the portal
     * exam card and hall ticket have data. The first paper is deliberately put
     * in the class's own room (= its timetable room) during period hours, so the
     * warn-only clash advisory fires and the admin editor shows the warn badge. */
    async function seedExamsBlock(classId: string): Promise<void> {
      const seriesList = await expectJson<{ series: { id: string; name: string }[] }>(
        await call("exams.series-list", { cookie: adminCookie, query: { collegeId, academicYear: YEAR } }),
        [200],
        "series list",
      );
      let seriesId = seriesList.series.find((s) => s.name === "Midterm")?.id;
      if (seriesId === undefined) {
        const created = await expectJson<{ id: string }>(
          await call("exams.series-create", {
            cookie: adminCookie,
            body: { collegeId, name: "Midterm", academicYear: YEAR, term: "Term 1" },
          }),
          [201],
          "series create",
        );
        seriesId = created.id;
      }

      const tree = await expectJson<{
        departments: { classes: { id: string; code: string }[]; subjects: { id: string }[] }[];
      }>(await call("people.college-tree", { cookie: adminCookie, params: { collegeId } }), [200], "tree for exams");
      const department = tree.departments.find((dep) => dep.classes.some((cls) => cls.id === classId));
      const classCode = department?.classes.find((cls) => cls.id === classId)?.code ?? "";
      const subjects = department?.subjects ?? [];
      if (subjects.length === 0) {
        console.log("  exams: no subjects for the demo class — skipping");
        return;
      }

      let scheduled = 0;
      let clash: string | undefined;
      for (const [index, subject] of subjects.entries()) {
        // Consecutive weekday mornings from 2026-12-01 (skip weekends).
        const day = new Date(Date.UTC(2026, 11, 1 + index));
        while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
        const onDate = day.toISOString().slice(0, 10);
        // First paper: the class's own room (its timetable room) → deliberate clash.
        const room = index === 0 ? classCode : "Exam Hall";
        const res = await call("exams.slot-create", {
          cookie: adminCookie,
          body: { seriesId, classId, subjectId: subject.id, onDate, starts: "09:00", ends: "11:00", room },
        });
        if (res.status === 201) {
          scheduled++;
          const warn = ((await res.json()) as { clash?: string }).clash;
          if (warn !== undefined) clash = warn;
        } else if (res.status !== 409) {
          throw new Error(`slot create: ${res.status} — ${await res.text()}`);
        }
      }
      console.log(
        `  exams: Midterm series, ${scheduled}/${subjects.length} papers scheduled` +
          (clash !== undefined ? ` (clash warned: "${clash}")` : ""),
      );
    }

    /** Leave demo data (L4) — idempotent: skips when the teacher already has
     * requests. Applies one casual leave as a CSE teacher, leaves it pending, and
     * applies + approves a second (sick) as the same teacher decided by the HOD, so
     * the HOD queue shows one waiting and the teacher sees one approved. */
    async function seedLeaveBlock(teacherCookie: string, hodCookie: string): Promise<void> {
      const mine = await expectJson<{ requests: { id: string }[] }>(
        await call("leave.my-requests", { cookie: teacherCookie }),
        [200],
        "leave mine",
      );
      if (mine.requests.length > 0) {
        console.log("  leave: requests already present — skipping");
        return;
      }
      // One left pending for the HOD queue.
      await expectJson(
        await call("leave.apply", {
          cookie: teacherCookie,
          body: { fromOn: "2026-08-10", toOn: "2026-08-11", kind: "casual", reason: "Family function" },
        }),
        [201],
        "leave apply (pending)",
      );
      // One applied then approved by the HOD.
      const toApprove = await expectJson<{ id: string }>(
        await call("leave.apply", {
          cookie: teacherCookie,
          body: { fromOn: "2026-07-20", toOn: "2026-07-20", kind: "sick", reason: "Fever" },
        }),
        [201],
        "leave apply (to approve)",
      );
      const decided = await call("leave.decide", {
        cookie: hodCookie,
        params: { requestId: toApprove.id },
        body: { status: "approved" },
      });
      if (decided.status !== 200) {
        throw new Error(`leave decide: ${decided.status} — ${await decided.text()}`);
      }
      console.log("  leave: 1 pending + 1 approved for a CSE teacher");
    }

    // 2) The principal — college-wide, sees every department. A 409 here means
    //    the demo tree already exists: run only the incremental blocks (fees)
    //    against the existing tree instead of failing.
    const principalCreated = await call("identity.user-create", {
      cookie: adminCookie,
      body: { username: "demo-principal", displayName: "Dr. Sudha Menon", collegeId, temporaryPassword: "temporary-pass-123", roles: ["principal"] },
    });
    if (principalCreated.status === 409) {
      console.log("demo tree already seeded — applying the fees increment only");
      const tree = await expectJson<{ departments: { classes: { id: string; sections: { id: string }[] }[] }[] }>(
        await call("people.college-tree", { cookie: adminCookie, params: { collegeId } }),
        [200],
        "college tree",
      );
      const klass = tree.departments[0]?.classes[0];
      const section = klass?.sections[0];
      if (klass !== undefined && section !== undefined) {
        const roster = await expectJson<{ students: { id: string; admissionNo: string }[] }>(
          await call("people.section-roster", { cookie: adminCookie, params: { sectionId: section.id } }),
          [200],
          "roster for fees increment",
        );
        const portal = roster.students.find((s) => s.admissionNo.endsWith("-001")) ?? roster.students[0];
        await seedFeesBlock({ classId: klass.id, sectionId: section.id, portalStudentId: portal?.id ?? null });
        await seedNoticesBlock(klass.id);
        await seedResultsBlock(klass.id);
        await seedExamsBlock(klass.id);
      }
      const incrementalTeacherCookie = await login(stack, "demo-teacher-ds", TEACHER_PASSWORD);
      const incrementalHodCookie = await login(stack, "demo-hod-cse", STAFF_PASSWORD);
      await seedLeaveBlock(incrementalTeacherCookie, incrementalHodCookie);
      console.log("\n✓ Fees increment seeded on the existing demo tree.");
      printCredentials(demoCredentials());
      await stack.close();
      return;
    }
    const principalId = ((await expectJson<{ id: string }>(principalCreated, [201], "user-create demo-principal")) ).id;
    {
      const reset = await call("identity.password-reset-init", { cookie: adminCookie, params: { userId: principalId } });
      const { token } = await expectJson<{ token: string }>(reset, [200, 201], "reset-init demo-principal");
      const confirm = await call("identity.password-reset-confirm", { body: { token, newPassword: STAFF_PASSWORD } });
      if (confirm.status !== 200) throw new Error(`reset-confirm demo-principal: ${confirm.status}`);
    }
    const principalGrant = await call("identity.grant-add", {
      cookie: adminCookie,
      params: { userId: principalId },
      body: { role: "principal", collegeId },
    });
    await expectJson(principalGrant, [201], "principal grant");
    credentials.push({ role: "principal", username: "demo-principal", password: STAFF_PASSWORD, scope: "college-wide" });

    // 3) Walk the tree: departments → HoD, classes → sections/subjects/teachers → students.
    for (const dept of DEPARTMENTS) {
      const deptRes = await call("people.department-create", {
        cookie: adminCookie,
        body: { collegeId, name: dept.name, code: dept.code },
      });
      if (deptRes.status === 409) {
        console.log("\nThe demo tree already exists in this database — nothing to rebuild.");
        printCredentials(demoCredentials());
        await stack.close();
        return;
      }
      const departmentId = (await expectJson<{ id: string }>(deptRes, [201], `department ${dept.code}`)).id;
      console.log(`  department: ${dept.name}`);

      const hodId = await provisionUser(dept.hod.username, dept.hod.displayName, ["hod"], STAFF_PASSWORD);
      await expectJson(
        await call("identity.grant-add", {
          cookie: adminCookie,
          params: { userId: hodId },
          body: { role: "hod", collegeId, departmentId },
        }),
        [201],
        `hod grant ${dept.code}`,
      );
      credentials.push({
        role: "hod",
        username: dept.hod.username,
        password: STAFF_PASSWORD,
        scope: `${dept.name} department`,
      });
      if (dept.code === "CSE") {
        leaveHodCookie = await login(stack, dept.hod.username, STAFF_PASSWORD);
      }

      for (const klass of dept.classes) {
        const classId = (
          await expectJson<{ id: string }>(
            await call("people.class-create", {
              cookie: adminCookie,
              body: { departmentId, name: klass.name, code: klass.code },
            }),
            [201],
            `class ${klass.code}`,
          )
        ).id;

        const sectionIds = new Map<string, string>();
        for (const sectionName of klass.sections) {
          const sectionId = (
            await expectJson<{ id: string }>(
              await call("people.section-create", { cookie: adminCookie, body: { classId, name: sectionName } }),
              [201],
              `section ${klass.code}-${sectionName}`,
            )
          ).id;
          sectionIds.set(sectionName, sectionId);
        }
        const rosterSectionId = sectionIds.get(klass.rosterSection)!;

        // Subjects + one subject teacher each (derived grant via assignment).
        const subjectTeacherCookies = new Map<string, string>();
        const subjectIds = new Map<string, string>();
        for (const subject of klass.subjects) {
          const subjectId = (
            await expectJson<{ id: string }>(
              await call("people.subject-create", {
                cookie: adminCookie,
                body: { departmentId, name: subject.name, code: `${subject.code}-${klass.code}` },
              }),
              [201],
              `subject ${subject.code}`,
            )
          ).id;
          subjectIds.set(subject.code, subjectId);
          const cookie = await provisionTeacher(
            stack,
            adminCookie,
            collegeId,
            subject.teacher.username,
            subject.teacher.displayName,
            classId,
            { kind: "subject_teacher", subjectId },
          );
          subjectTeacherCookies.set(subject.code, cookie);
          if (dept.code === "CSE" && subject.code === "DS") {
            leaveTeacherCookie = cookie;
          }
          credentials.push({
            role: "teacher",
            username: subject.teacher.username,
            password: TEACHER_PASSWORD,
            scope: `${subject.name} · ${klass.name}`,
          });
        }

        // Class teacher: class-wide oversight AND teaches a foundation subject
        // to their own class (a class teacher always teaches a subject).
        const ctSubjectId = (
          await expectJson<{ id: string }>(
            await call("people.subject-create", {
              cookie: adminCookie,
              body: { departmentId, name: "Communication Skills", code: `COMM-${klass.code}` },
            }),
            [201],
            `ct subject ${klass.code}`,
          )
        ).id;
        subjectIds.set("COMM", ctSubjectId);
        const classTeacherCookie = await provisionTeacher(
          stack,
          adminCookie,
          collegeId,
          klass.classTeacher.username,
          klass.classTeacher.displayName,
          classId,
          { kind: "class_teacher" },
          ctSubjectId,
        );
        subjectTeacherCookies.set("COMM", classTeacherCookie);
        credentials.push({
          role: "class_teacher",
          username: klass.classTeacher.username,
          password: TEACHER_PASSWORD,
          scope: `${klass.name} — class teacher + teaches Communication Skills`,
        });

        // Students → enrol in the roster section.
        const studentIds: string[] = [];
        for (let i = 0; i < klass.students.length; i++) {
          const fullName = klass.students[i]!;
          const studentId = (
            await expectJson<{ id: string }>(
              await call("people.student-create", {
                cookie: adminCookie,
                body: { collegeId, admissionNo: `${klass.code}-${String(i + 1).padStart(3, "0")}`, fullName },
              }),
              [201],
              `student ${fullName}`,
            )
          ).id;
          const enroll = await call("people.student-enroll", {
            cookie: adminCookie,
            params: { studentId },
            body: { sectionId: rosterSectionId, academicYear: YEAR },
          });
          if (enroll.status !== 200) throw new Error(`enroll ${fullName}: ${enroll.status}`);
          studentIds.push(studentId);

          // 2.5 profile depth — personal + guardian contact (demo data).
          const surname = fullName.split(" ").slice(-1)[0] ?? fullName;
          const dobYear = 2008 - (klass.code.startsWith("SY") ? 1 : klass.code.startsWith("TY") ? 2 : 0);
          const profile = await call("people.student-update", {
            cookie: adminCookie,
            params: { studentId },
            body: {
              phone: `+91 ${9876500000 + i}`,
              guardianName: `${i % 2 === 0 ? "Mr." : "Mrs."} ${surname}`,
              guardianPhone: `+91 ${9822000000 + i}`,
              dob: `${dobYear}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
            },
          });
          if (profile.status !== 200) throw new Error(`profile ${fullName}: ${profile.status}`);
          if (portalStudentId === null) {
            portalStudentId = studentId; // the first seeded student gets the demo portal sign-in
            portalStudentName = fullName;
          }
          if (feesClassId === null) {
            feesClassId = classId; // fees demo data targets the first seeded class
            feesSectionId = rosterSectionId;
          }
        }
        console.log(
          `    class: ${klass.name} — ${klass.sections.length} sections, ${studentIds.length} students, ${klass.subjects.length} subjects`,
        );

        // 3b) The struggler (student 0) is moved to backlog (ATKT) — the
        //     lifecycle status, audited, record never destroyed. Their F marks
        //     also surface them on the derived backlog-status report.
        if (studentIds[0] !== undefined) {
          const marked = await call("people.student-update", {
            cookie: adminCookie,
            params: { studentId: studentIds[0] },
            body: { status: "backlog" },
          });
          if (marked.status !== 200) throw new Error(`mark backlog ${klass.code}: ${marked.status}`);
        }

        // 4) Attendance (class teacher) over a run of school days. Student 0 is
        //    the designated struggler so the at-risk surface has something real.
        const days = attendanceDays();
        for (let d = 0; d < days.length; d++) {
          const entries: Slot[] = studentIds.map((studentId, s) => ({
            studentId,
            status: attendanceStatus(s, d),
          }));
          const recorded = await call("academics.attendance-record", {
            cookie: classTeacherCookie,
            body: { sectionId: rosterSectionId, heldOn: days[d]!, slot: "day", academicYear: YEAR, entries },
          });
          if (recorded.status !== 201) throw new Error(`attendance ${klass.code} ${days[d]}: ${recorded.status}`);
        }
        console.log(`    attendance: ${days.length} days recorded by ${klass.classTeacher.username}`);

        // 4b) Subject-teacher attendance (the subject-teacher revision): the
        //     first subject's teacher marks their OWN period, driven through
        //     the same scope-checked route. If a subject teacher could NOT
        //     write their period, THIS seed step fails loudly — so a green
        //     seed is itself the live proof of the new authority. Same
        //     per-student status as the day session keeps analytics
        //     percentages identical (present/total ratio is preserved).
        const firstSubject = klass.subjects[0];
        if (firstSubject !== undefined) {
          const subjTeacherCookie = subjectTeacherCookies.get(firstSubject.code)!;
          const subjId = subjectIds.get(firstSubject.code)!;
          for (let d = 0; d < days.length; d++) {
            const entries: Slot[] = studentIds.map((studentId, s) => ({
              studentId,
              status: attendanceStatus(s, d),
            }));
            const recorded = await call("academics.attendance-record", {
              cookie: subjTeacherCookie,
              body: {
                sectionId: rosterSectionId,
                subjectId: subjId,
                heldOn: days[d]!,
                slot: firstSubject.code,
                academicYear: YEAR,
                entries,
              },
            });
            if (recorded.status !== 201) {
              throw new Error(`subject attendance ${klass.code}/${firstSubject.code} ${days[d]}: ${recorded.status}`);
            }
          }
          console.log(
            `    subject attendance: ${days.length} ${firstSubject.name} periods recorded by ${firstSubject.teacher.username}`,
          );
        }

        // 5) Marks — each subject teacher creates assessments and enters scores.
        for (const subject of klass.subjects) {
          const teacherCookie = subjectTeacherCookies.get(subject.code)!;
          const subjectId = subjectIds.get(subject.code)!;
          for (const assessment of [
            { kind: "quiz" as const, name: "Quiz 1", maxScore: 10 },
            { kind: "quiz" as const, name: "Unit Test 1", maxScore: 20 },
            { kind: "exam" as const, name: "Assignment 1", maxScore: 25 },
            { kind: "exam" as const, name: "Midterm", maxScore: 100 },
            { kind: "quiz" as const, name: "Quiz 2", maxScore: 10 },
          ]) {
            const assessmentId = (
              await expectJson<{ id: string }>(
                await call("academics.assessment-create", {
                  cookie: teacherCookie,
                  body: {
                    classId,
                    subjectId,
                    kind: assessment.kind,
                    name: assessment.name,
                    academicYear: YEAR,
                    maxScore: assessment.maxScore,
                  },
                }),
                [201],
                `assessment ${subject.code} ${assessment.name}`,
              )
            ).id;
            const entries = studentIds.map((studentId, s) => ({
              studentId,
              score: markScore(s, assessment.maxScore),
            }));
            const entered = await call("academics.marks-enter", {
              cookie: teacherCookie,
              params: { assessmentId },
              body: { entries },
            });
            if (entered.status !== 200) throw new Error(`marks ${subject.code} ${assessment.name}: ${entered.status}`);
          }
        }
        console.log(`    marks: entered for every subject by its own teacher`);

        // 5c) Syllabus: the first subject's teacher authors units + topics and
        //     marks Unit 1 taught — through the same scope-checked routes, so a
        //     green seed proves the subject-teacher authoring authority. Coverage
        //     is derived, giving the portal a partial % (Unit 1 taught, Unit 2 not).
        const sylSubject = klass.subjects[0];
        if (sylSubject !== undefined) {
          const sylTeacherCookie = subjectTeacherCookies.get(sylSubject.code)!;
          const sylSubjectId = subjectIds.get(sylSubject.code)!;
          const units = syllabusFor(sylSubject.code, sylSubject.name);
          const taughtDates = ["2026-07-01", "2026-07-04", "2026-07-08", "2026-07-11"];
          for (let u = 0; u < units.length; u++) {
            const unit = units[u]!;
            const unitId = (
              await expectJson<{ id: string }>(
                await call("syllabus.unit-create", {
                  cookie: sylTeacherCookie,
                  body: { classId, subjectId: sylSubjectId, academicYear: YEAR, title: unit.title, position: u },
                }),
                [201],
                `syllabus unit ${klass.code}/${sylSubject.code} ${unit.title}`,
              )
            ).id;
            for (let t = 0; t < unit.topics.length; t++) {
              const topicId = (
                await expectJson<{ id: string }>(
                  await call("syllabus.topic-create", {
                    cookie: sylTeacherCookie,
                    params: { unitId },
                    body: { title: unit.topics[t]!, position: t },
                  }),
                  [201],
                  `syllabus topic ${unit.topics[t]}`,
                )
              ).id;
              if (u === 0) {
                await expectJson(
                  await call("syllabus.topic-coverage", {
                    cookie: sylTeacherCookie,
                    params: { topicId },
                    body: { taughtOn: taughtDates[t % taughtDates.length] },
                  }),
                  [200],
                  `syllabus coverage ${unit.topics[t]}`,
                );
              }
            }
          }
          console.log(`    syllabus: ${units.length} units for ${sylSubject.name} by ${sylSubject.teacher.username}`);
        }

        // 5b) Timetable: P1–P3 Mon–Fri for the roster section, subjects
        //     rotating, each taught by its own subject teacher (room = the
        //     class code, so classes never clash on rooms).
        const assignmentsRes = await expectJson<{
          assignments: { teacherId: string; subjectId: string | null; kind: string }[];
        }>(
          await call("people.class-assignments", { cookie: adminCookie, params: { classId } }),
          [200],
          `assignments for timetable ${klass.code}`,
        );
        const teacherOfSubject = new Map(
          assignmentsRes.assignments
            .filter((a) => a.kind === "subject_teacher" && a.subjectId !== null)
            .map((a) => [a.subjectId!, a.teacherId]),
        );
        const subjectIdList = [...subjectIds.values()];
        let slotIndex = 0;
        for (let day = 1; day <= 5; day++) {
          for (let periodNo = 1; periodNo <= 3; periodNo++) {
            const subjectId = subjectIdList[slotIndex % subjectIdList.length]!;
            slotIndex++;
            const teacherId = teacherOfSubject.get(subjectId);
            if (teacherId === undefined) continue;
            const scheduled = await call("timetable.entry-create", {
              cookie: adminCookie,
              body: {
                sectionId: rosterSectionId,
                subjectId,
                teacherId,
                room: klass.code,
                dayOfWeek: day,
                periodNo,
                academicYear: YEAR,
              },
            });
            if (scheduled.status !== 201 && scheduled.status !== 409) {
              throw new Error(`timetable ${klass.code} d${day}p${periodNo}: ${scheduled.status}`);
            }
          }
        }
        console.log(`    timetable: P1–P3 Mon–Fri scheduled`);

        // 5d) Sections B and C: freshly enrolled students, no records — the
        //     A-anchored data above (attendance/marks/syllabus/timetable) is
        //     untouched. Gives a future section-switcher real sections to
        //     switch between (honestly empty of history).
        let extraCount = 0;
        for (const [sectionName, names] of [
          ["B", klass.sectionB] as const,
          ["C", klass.sectionC] as const,
        ]) {
          const sectionId = sectionIds.get(sectionName)!;
          for (let j = 0; j < names.length; j++) {
            const fullName = names[j]!;
            const idx = klass.students.length + extraCount; // continues the class's per-field index series
            const studentId = (
              await expectJson<{ id: string }>(
                await call("people.student-create", {
                  cookie: adminCookie,
                  body: { collegeId, admissionNo: `${klass.code}-${sectionName}${String(j + 1).padStart(2, "0")}`, fullName },
                }),
                [201],
                `student ${fullName}`,
              )
            ).id;
            const enroll = await call("people.student-enroll", {
              cookie: adminCookie,
              params: { studentId },
              body: { sectionId, academicYear: YEAR },
            });
            if (enroll.status !== 200) throw new Error(`enroll ${fullName}: ${enroll.status}`);

            // Same 2.5 profile depth as the section-A students above.
            const surname = fullName.split(" ").slice(-1)[0] ?? fullName;
            const dobYear = 2008 - (klass.code.startsWith("SY") ? 1 : klass.code.startsWith("TY") ? 2 : 0);
            const profile = await call("people.student-update", {
              cookie: adminCookie,
              params: { studentId },
              body: {
                phone: `+91 ${9876500000 + idx}`,
                guardianName: `${idx % 2 === 0 ? "Mr." : "Mrs."} ${surname}`,
                guardianPhone: `+91 ${9822000000 + idx}`,
                dob: `${dobYear}-${String((idx % 12) + 1).padStart(2, "0")}-${String((idx % 27) + 1).padStart(2, "0")}`,
              },
            });
            if (profile.status !== 200) throw new Error(`profile ${fullName}: ${profile.status}`);
            extraCount++;
          }
        }
        console.log(`    sections B/C: ${extraCount} students enrolled (no records — fresh sections)`);
      }
    }

    // 6) The student portal sign-in (W1): a real student login linked to the
    //    first seeded student — self-scoped, no grants.
    if (portalStudentId !== null) {
      const studentUserId = await provisionUser("demo-student", portalStudentName, ["student"], STUDENT_PASSWORD);
      const linked = await call("people.student-link-identity", {
        cookie: adminCookie,
        params: { studentId: portalStudentId },
        body: { identityUserId: studentUserId },
      });
      await expectJson(linked, [200], "student identity link");
      credentials.push({
        role: "student",
        username: "demo-student",
        password: STUDENT_PASSWORD,
        scope: `self — ${portalStudentName} (portal)`,
      });
    }

    // 6b) Fees (M4): accountant sign-in + heads/structures/invoices/payments.
    if (feesClassId !== null && feesSectionId !== null) {
      await seedFeesBlock({ classId: feesClassId, sectionId: feesSectionId, portalStudentId });
      credentials.push({
        role: "accountant",
        username: "demo-accountant",
        password: ACCOUNTANT_PASSWORD,
        scope: "college-wide (fees)",
      });
    }

    // 6c) Notices (M3): three live notices — college-wide, students, one class.
    if (feesClassId !== null) await seedNoticesBlock(feesClassId);

    // 6d) Results (M5): scale + credits + Term 1 published for the demo class.
    if (feesClassId !== null) await seedResultsBlock(feesClassId);

    // 6e) Exams (M6): Midterm series + papers scheduled for the demo class.
    if (feesClassId !== null) await seedExamsBlock(feesClassId);

    // 6f) Leave (M7): a pending + an approved request for a CSE teacher.
    if (leaveTeacherCookie !== null && leaveHodCookie !== null) {
      await seedLeaveBlock(leaveTeacherCookie, leaveHodCookie);
    }

    // 7) Flip any resolvable manual grants (principal/HoD) to verified.
    await call("identity.grants-verify", { cookie: adminCookie });

    console.log("\n✓ Demo data seeded through the real scoped, audited chain.");
    printCredentials(credentials);
    await stack.close();
  } catch (error) {
    await stack.close();
    throw error;
  }
}

/** Creates identity user + teacher record + link + assignment; returns a live session cookie. */
async function provisionTeacher(
  stack: Stack,
  adminCookie: string,
  collegeId: string,
  username: string,
  displayName: string,
  classId: string,
  assignment: { kind: "subject_teacher" | "class_teacher"; subjectId?: string },
  /** A class teacher ALSO teaches a subject — pass it to add a second assignment. */
  extraSubjectId?: string,
): Promise<string> {
  const created = await stack.call("identity.user-create", {
    cookie: adminCookie,
    body: { username, displayName, collegeId, temporaryPassword: "temporary-pass-123", roles: [] },
  });
  const userId = (await expectJson<{ id: string }>(created, [201], `teacher user ${username}`)).id;
  const reset = await stack.call("identity.password-reset-init", { cookie: adminCookie, params: { userId } });
  const { token } = await expectJson<{ token: string }>(reset, [200, 201], `teacher reset ${username}`);
  const confirm = await stack.call("identity.password-reset-confirm", {
    body: { token, newPassword: TEACHER_PASSWORD },
  });
  if (confirm.status !== 200) throw new Error(`teacher reset-confirm ${username}: ${confirm.status}`);

  const teacherId = (
    await expectJson<{ id: string }>(
      await stack.call("people.teacher-create", {
        cookie: adminCookie,
        body: { collegeId, staffNo: `S-${username}`, fullName: displayName },
      }),
      [201],
      `teacher record ${username}`,
    )
  ).id;
  await stack.call("people.teacher-link-identity", {
    cookie: adminCookie,
    params: { teacherId },
    body: { identityUserId: userId },
  });
  const assignmentRes = await stack.call("people.assignment-create", {
    cookie: adminCookie,
    params: { teacherId },
    body: {
      classId,
      ...(assignment.subjectId !== undefined ? { subjectId: assignment.subjectId } : {}),
      kind: assignment.kind,
      academicYear: YEAR,
    },
  });
  await expectJson(assignmentRes, [201], `assignment ${username}`);
  if (extraSubjectId !== undefined) {
    // A class teacher also teaches a subject to their class — a second assignment.
    const extra = await stack.call("people.assignment-create", {
      cookie: adminCookie,
      params: { teacherId },
      body: { classId, subjectId: extraSubjectId, kind: "subject_teacher", academicYear: YEAR },
    });
    await expectJson(extra, [201], `extra assignment ${username}`);
  }
  return login(stack, username, TEACHER_PASSWORD);
}

async function login(stack: Stack, username: string, password: string): Promise<string> {
  const res = await stack.call("identity.login", { body: { username, password } });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return cookieFrom(res);
}

/** Every weekday from 2026-06-01 to the demo anchor 2026-07-06 (AY 2026-27). */
function attendanceDays(): string[] {
  const days: string[] = [];
  const cursor = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-07-06T00:00:00Z");
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Student 0 misses ~40% of days (low-attendance flag); others attend reliably. */
function attendanceStatus(studentIndex: number, dayIndex: number): Slot["status"] {
  if (studentIndex === 0) return dayIndex % 5 < 2 ? "absent" : "present";
  if (studentIndex === 1 && dayIndex % 7 === 3) return "excused";
  return dayIndex % 11 === 6 ? "absent" : "present";
}

/** Student 0 scores below the pass line (low-marks flag); others spread 55–92%. */
function markScore(studentIndex: number, maxScore: number): number {
  const pct = studentIndex === 0 ? 34 : 55 + ((studentIndex * 37) % 38);
  return Math.round((pct / 100) * maxScore);
}

/** The credential list, derived from the demo tree (for the already-seeded path). */
function demoCredentials(): Credential[] {
  const creds: Credential[] = [
    { role: "admin", username: ADMIN.username, password: ADMIN.password, scope: "college-wide" },
    { role: "principal", username: "demo-principal", password: STAFF_PASSWORD, scope: "college-wide" },
    { role: "student", username: "demo-student", password: STUDENT_PASSWORD, scope: "self (portal)" },
    { role: "accountant", username: "demo-accountant", password: ACCOUNTANT_PASSWORD, scope: "college-wide (fees)" },
  ];
  for (const dept of DEPARTMENTS) {
    creds.push({ role: "hod", username: dept.hod.username, password: STAFF_PASSWORD, scope: `${dept.name} department` });
    for (const klass of dept.classes) {
      creds.push({
        role: "class_teacher",
        username: klass.classTeacher.username,
        password: TEACHER_PASSWORD,
        scope: `${klass.name} (all subjects)`,
      });
      for (const subject of klass.subjects) {
        creds.push({
          role: "teacher",
          username: subject.teacher.username,
          password: TEACHER_PASSWORD,
          scope: `${subject.name} · ${klass.name}`,
        });
      }
    }
  }
  return creds;
}

function printCredentials(credentials: Credential[]): void {
  console.log("\nSign-in credentials (demo only — never reuse these passwords):\n");
  const width = Math.max(...credentials.map((c) => c.username.length), 8);
  for (const cred of credentials) {
    console.log(
      `  ${cred.role.padEnd(13)} ${cred.username.padEnd(width)}  ${cred.password.padEnd(24)} ${cred.scope}`,
    );
  }
  console.log("\nOpen the web app, sign in as each role, and watch the dashboard show only that");
  console.log("role's scope. Generate a student report as the class teacher to see a scoped export.");
}

main().catch((error: unknown) => {
  console.error("\nseed-demo failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
