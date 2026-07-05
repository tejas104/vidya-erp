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
  type AuditLogger,
  type Db,
  type Metrics,
  type ObjectStorageClient,
  type OrgDirectory,
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
import { ImportService } from "./service/import-service";
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

export interface PeopleModuleDeps {
  readonly db: Db;
  readonly metrics: Metrics;
  /** The audit seam (system module's implementation). */
  readonly audit: AuditLogger;
  /** #2's scope-check chokepoint — every handler decision goes through it. */
  readonly scopeChecker: ScopeChecker;
  /** Identity's derived-grant surface (ADR-0015). */
  readonly identityGrants: DerivedGrantsApi;
  readonly storage: { readonly client: ObjectStorageClient; readonly bucket: string };
  /** Enqueues the bulk-import job on the people queue (composition provides it). */
  readonly enqueueImport: (payload: z.infer<typeof importJobPayloadSchema>) => Promise<void>;
}

/** What composition roots and other modules may use. */
export interface PeopleModuleService {
  /** #2's OrgDirectory contract — injected into identity for grant verification. */
  readonly orgDirectory: OrgDirectory;
  /** One-time operator bootstrap (scripts/create-admin.ts). Idempotent by code. */
  bootstrapCollege(input: { name: string; code: string }): Promise<{ collegeId: string; created: boolean }>;
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
      enqueueImport: deps.enqueueImport,
    }),
    jobProcessors: {
      [IMPORT_JOB_NAME]: createImportProcessor(imports),
      [RECONCILE_JOB_NAME]: createReconcileProcessor(assignments),
    },
    readinessChecks: [],
    service: {
      orgDirectory: org.orgDirectory,
      bootstrapCollege: (input) => org.bootstrapCollege(input),
    },
  };
  assertModuleWiring(module);
  return module;
}
