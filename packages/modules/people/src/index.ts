/**
 * @vidya/module-people — PUBLIC API (the only importable surface).
 *
 * The canonical org tree (college→department→class→section + subjects),
 * student/teacher records, enrollment, teacher assignments (source of
 * truth for derived identity grants, ADR-0015), the OrgDirectory
 * implementation (#2's contract), and bulk CSV import via the worker.
 * Every read and write flows through #2's ScopeChecker in the handlers.
 */

import { Counter } from "prom-client";
import {
  assertModuleWiring,
  ensureBucket,
  getObjectText,
  putObjectText,
  type AppConfig,
  type AuditLogger,
  type Db,
  type Metrics,
  type ObjectStorageClient,
  type OrgDirectory,
  type OrgPath,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { DerivedGrantsApi } from "@vidya/module-identity";
import { z } from "zod";
import {
  IMPORT_JOB_NAME,
  RECONCILE_JOB_NAME,
  importJobPayloadSchema,
  peopleModuleDefinition,
} from "./definition";
import { createOrgRepo } from "./repo/org-repo";
import { createPeopleRepo } from "./repo/people-repo";
import { createImportsRepo } from "./repo/imports-repo";
import { OrgService } from "./service/org-service";
import { PeopleService } from "./service/people-service";
import { AssignmentsService } from "./service/assignments-service";
import { ImportService, type CredentialIssuer } from "./service/import-service";
import { createPeopleHandlers } from "./api/handlers";
import { createImportProcessor } from "./jobs/import-job";
import { createReconcileProcessor } from "./jobs/reconcile-job";

export {
  IMPORT_JOB_NAME,
  RECONCILE_JOB_NAME,
  RECONCILE_SCHEDULER_ID,
  MODULE_NAME as PEOPLE_MODULE_NAME,
  peopleModuleDefinition,
} from "./definition";
export { ASSIGNMENT_SOURCE_PREFIX } from "./service/assignments-service";
export type { CredentialIssuer } from "./service/import-service";
/** Shared username derivation (#11 B4) — the reporting module's per-class
 *  credential sheet reuses this so the scheme is identical everywhere. */
export { usernameFromCode } from "./ids";

export interface PeopleModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  /** The audit seam (system module's implementation). */
  readonly audit: AuditLogger;
  /** #2's scope-check chokepoint — every handler decision goes through it. */
  readonly scopeChecker: ScopeChecker;
  /** Identity's derived-grant surface (ADR-0015). */
  readonly identityGrants: DerivedGrantsApi;
  /** Identity's credential issuance (#11 B4: import-confirm auto-issue, per-staff action). */
  readonly identity: CredentialIssuer;
  readonly storage: { readonly client: ObjectStorageClient; readonly bucket: string };
  /** Enqueues the bulk-import job on the people queue (composition provides it). */
  readonly enqueueImport: (payload: z.infer<typeof importJobPayloadSchema>) => Promise<void>;
  /** Drives the import-template CSV headers (#11 Task 1). Defaults to "college" like env.ts. */
  readonly edition?: AppConfig["edition"];
}

/**
 * Read-only directory other modules use to resolve org positions and
 * validate people references (#4's academics module is the first
 * consumer). All ids are the same opaque identifiers grants carry.
 */
export interface PeopleDirectory {
  sectionPath(sectionId: string): Promise<OrgPath | null>;
  classPath(classId: string): Promise<OrgPath | null>;
  departmentPath(departmentId: string): Promise<OrgPath | null>;
  collegeExists(collegeId: string): Promise<boolean>;
  /** Live enrollments of a section: who attendance can be marked for. */
  sectionRoster(sectionId: string): Promise<{ studentId: string; academicYear: string }[]>;
  /** Enrollment-derived org position; `{collegeId}` for unenrolled students. */
  studentPosition(studentId: string): Promise<OrgPath | null>;
  /** W1 portal: the student linked to this identity sign-in, if any. */
  studentByIdentityUser(
    identityUserId: string,
  ): Promise<{ studentId: string; collegeId: string; fullName: string; admissionNo: string; status: string } | null>;
  /** Timetable self-scope: the teacher linked to this identity sign-in, if any. */
  teacherByIdentityUser(
    identityUserId: string,
  ): Promise<{ teacherId: string; collegeId: string; fullName: string } | null>;
  /** Leave routing: the departments a teacher belongs to (via assignments). */
  teacherDepartments(teacherId: string): Promise<string[]>;
  /** Which of these student ids exist (batched). */
  studentsExist(studentIds: readonly string[]): Promise<Set<string>>;
  /** Batched student display info for ledger views (fees). Unknown ids absent. */
  studentsBrief(studentIds: readonly string[]): Promise<Map<string, { fullName: string; admissionNo: string }>>;
  /** The department a subject belongs to, or null. */
  subjectDepartment(subjectId: string): Promise<string | null>;
  /** Sections with at least one live enrollment (attendance gap scan). */
  sectionsWithLiveEnrollment(): Promise<string[]>;
  /** A class's sections (id + display name), for dashboard tiles (#5). */
  sectionsOfClass(classId: string): Promise<{ sectionId: string; name: string }[]>;
  /** A college's departments (id + name), for cross-node comparison (analytics). */
  departmentsOfCollege(collegeId: string): Promise<{ departmentId: string; name: string }[]>;
  /** A department's classes (id + name), for cross-node comparison (analytics). */
  classesOfDepartment(departmentId: string): Promise<{ classId: string; name: string }[]>;
  /**
   * A class's full student roster — every section, flattened (#11 B4: the
   * per-class credential sheet). `admissionNo` doubles as the roll number;
   * there is no separate roll-number field. `identityUserId` is null for a
   * student who has no login yet — the caller decides what to do with that.
   */
  classRoster(
    classId: string,
  ): Promise<{ studentId: string; admissionNo: string; fullName: string; identityUserId: string | null }[]>;
  /**
   * Display names for opaque org/people ids (routed by id prefix across
   * colleges, departments, classes, sections, subjects and students).
   * Unknown ids are simply absent from the result.
   */
  namesFor(ids: readonly string[]): Promise<Map<string, string>>;
}

/** What composition roots and other modules may use. */
export interface PeopleModuleService {
  /** #2's OrgDirectory contract — injected into identity for grant verification. */
  readonly orgDirectory: OrgDirectory;
  /** Read-only resolution/validation surface for other modules (#4+). */
  readonly directory: PeopleDirectory;
  /** One-time operator bootstrap (scripts/create-admin.ts). Idempotent by code. */
  bootstrapCollege(input: { name: string; code: string }): Promise<{ collegeId: string; created: boolean }>;
  /**
   * Links a freshly identity-issued account back onto its student record
   * (#11 B4: the per-class credential sheet, owned by the reporting module —
   * reporting depends on people, never the reverse, so this write is
   * exposed here rather than reporting reaching into people's tables).
   * False when the student id does not exist.
   */
  linkStudentIdentity(studentId: string, identityUserId: string): Promise<boolean>;
}

export function createPeopleModule(deps: PeopleModuleDeps): RuntimeModule<PeopleModuleService> {
  const orgRepo = createOrgRepo(deps.db);
  const peopleRepo = createPeopleRepo(deps.db);
  const importsRepo = createImportsRepo(deps.db);

  const org = new OrgService({ repo: orgRepo, audit: deps.audit });
  const people = new PeopleService({ repo: peopleRepo, orgRepo });
  const assignments = new AssignmentsService({
    repo: peopleRepo,
    orgRepo,
    identityGrants: deps.identityGrants,
    audit: deps.audit,
  });

  const importsTotal = new Counter({
    name: "vidya_imports_total",
    help: "Bulk imports by kind and outcome",
    labelNames: ["kind", "status"],
    registers: [deps.metrics.registry],
  });
  let bucketReady = false;
  const ensureReady = async (): Promise<void> => {
    if (!bucketReady) {
      await ensureBucket(deps.storage.client, deps.storage.bucket);
      bucketReady = true;
    }
  };
  const imports = new ImportService({
    imports: importsRepo,
    people: peopleRepo,
    orgRepo,
    store: {
      putText: async (key, body) => {
        await ensureReady();
        await putObjectText(deps.storage.client, deps.storage.bucket, key, body, "text/csv; charset=utf-8");
      },
      getText: (key) => getObjectText(deps.storage.client, deps.storage.bucket, key),
    },
    audit: deps.audit,
    identity: deps.identity,
    onFinished: (kind, status) => importsTotal.inc({ kind, status }),
  });

  const module: RuntimeModule<PeopleModuleService> = {
    definition: peopleModuleDefinition,
    handlers: createPeopleHandlers({
      org,
      people,
      assignments,
      imports,
      scopeChecker: deps.scopeChecker,
      storage: deps.storage,
      enqueueImport: deps.enqueueImport,
      edition: deps.edition ?? "college",
      identity: deps.identity,
    }),
    jobProcessors: {
      [IMPORT_JOB_NAME]: createImportProcessor(imports),
      [RECONCILE_JOB_NAME]: createReconcileProcessor(assignments),
    },
    readinessChecks: [],
    service: {
      orgDirectory: org.orgDirectory,
      directory: {
        sectionPath: (sectionId) => orgRepo.pathForSection(sectionId),
        classPath: (classId) => orgRepo.pathForClass(classId),
        departmentPath: (departmentId) => orgRepo.pathForDepartment(departmentId),
        collegeExists: async (collegeId) => (await orgRepo.getCollege(collegeId)) !== null,
        sectionRoster: async (sectionId) =>
          (await peopleRepo.roster(sectionId)).map((entry) => ({
            studentId: entry.student.id,
            academicYear: entry.enrollment.academicYear,
          })),
        studentPosition: async (studentId) => {
          const student = await peopleRepo.getStudent(studentId);
          return student === null ? null : people.studentOrgPosition(student);
        },
        studentByIdentityUser: async (identityUserId) => {
          const student = await peopleRepo.findStudentByIdentityUser(identityUserId);
          return student === null
            ? null
            : {
                studentId: student.id,
                collegeId: student.collegeId,
                fullName: student.fullName,
                admissionNo: student.admissionNo,
                status: student.status,
              };
        },
        teacherByIdentityUser: async (identityUserId) => {
          const teacher = await peopleRepo.findTeacherByIdentityUser(identityUserId);
          return teacher === null
            ? null
            : { teacherId: teacher.id, collegeId: teacher.collegeId, fullName: teacher.fullName };
        },
        teacherDepartments: (teacherId) => peopleRepo.departmentsForTeacher(teacherId),
        studentsExist: (studentIds) => peopleRepo.findExistingStudentIds(studentIds),
        studentsBrief: async (studentIds) => {
          const briefs = new Map<string, { fullName: string; admissionNo: string }>();
          for (const id of new Set(studentIds)) {
            const row = await peopleRepo.getStudent(id);
            if (row !== null) briefs.set(id, { fullName: row.fullName, admissionNo: row.admissionNo });
          }
          return briefs;
        },
        subjectDepartment: async (subjectId) =>
          (await orgRepo.getSubject(subjectId))?.departmentId ?? null,
        sectionsWithLiveEnrollment: () => peopleRepo.sectionsWithLiveEnrollment(),
        sectionsOfClass: async (classId) =>
          (await orgRepo.listSectionsOfClass(classId)).map((section) => ({
            sectionId: section.id,
            name: section.name,
          })),
        departmentsOfCollege: async (collegeId) =>
          (await orgRepo.listDepartmentsOfCollege(collegeId)).map((department) => ({
            departmentId: department.id,
            name: department.name,
          })),
        classesOfDepartment: async (departmentId) =>
          (await orgRepo.listClassesOfDepartment(departmentId)).map((klass) => ({
            classId: klass.id,
            name: klass.name,
          })),
        classRoster: async (classId) => {
          const sections = await orgRepo.listSectionsOfClass(classId);
          const rows: { studentId: string; admissionNo: string; fullName: string; identityUserId: string | null }[] = [];
          for (const section of sections) {
            for (const entry of await peopleRepo.roster(section.id)) {
              rows.push({
                studentId: entry.student.id,
                admissionNo: entry.student.admissionNo,
                fullName: entry.student.fullName,
                identityUserId: entry.student.identityUserId,
              });
            }
          }
          return rows;
        },
        namesFor: async (ids) => {
          const names = new Map<string, string>();
          for (const id of ids) {
            if (id.startsWith("col_")) {
              const row = await orgRepo.getCollege(id);
              if (row !== null) names.set(id, row.name);
            } else if (id.startsWith("dep_")) {
              const row = await orgRepo.getDepartment(id);
              if (row !== null) names.set(id, row.name);
            } else if (id.startsWith("cls_")) {
              const row = await orgRepo.getClass(id);
              if (row !== null) names.set(id, row.name);
            } else if (id.startsWith("sec_")) {
              const row = await orgRepo.getSection(id);
              if (row !== null) names.set(id, row.name);
            } else if (id.startsWith("sub_")) {
              const row = await orgRepo.getSubject(id);
              if (row !== null) names.set(id, row.name);
            } else if (id.startsWith("stu_")) {
              const row = await peopleRepo.getStudent(id);
              if (row !== null) names.set(id, row.fullName);
            } else if (id.startsWith("tch_")) {
              const row = await peopleRepo.getTeacher(id);
              if (row !== null) names.set(id, row.fullName);
            }
          }
          return names;
        },
      },
      bootstrapCollege: (input) => org.bootstrapCollege(input),
      linkStudentIdentity: async (studentId, identityUserId) =>
        (await people.linkStudentIdentity(studentId, identityUserId)) !== null,
    },
  };
  assertModuleWiring(module);
  return module;
}
