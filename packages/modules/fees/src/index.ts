/**
 * @vidya/module-fees — PUBLIC API (the only importable surface).
 *
 * Heads → per-class structures → invoices (generated in bulk by the worker,
 * idempotent per student×structure) → payments (transactional, gap-free
 * per-college receipt numbers) → adjustments (scholarship/fine/refund/waiver).
 * Integer paise everywhere (see money.ts). Accountant authority comes from
 * grantAllows (writes confined to module "fees"); students reach their own
 * fees only through the identity link.
 */

import {
  assertModuleWiring,
  type TransactionalAuditLogger,
  type Db,
  type RuntimeModule,
  type ScopeChecker,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import { feesModuleDefinition, INVOICE_GENERATE_JOB_NAME } from "./definition";
import { createFeesHandlers } from "./handlers";
import { createGenerateProcessor } from "./generate-job";
import { createFeesRepo } from "./repo";

export { MODULE_NAME as FEES_MODULE_NAME, feesModuleDefinition, INVOICE_GENERATE_JOB_NAME } from "./definition";

export interface FeesModuleDeps {
  readonly db: Db;
  /** Must write inside the caller's transaction: payment/adjustment audit rows commit atomically (ADR-0026). */
  readonly audit: TransactionalAuditLogger;
  readonly scopeChecker: ScopeChecker;
  readonly peopleDirectory: PeopleDirectory;
  /** Enqueues the invoice-generate job (BullMQ in prod, inline fake in tests). */
  readonly enqueueGenerate: (payload: { runId: string }) => Promise<void>;
}

export function createFeesModule(deps: FeesModuleDeps): RuntimeModule<Record<string, never>> {
  const repo = createFeesRepo(deps.db, deps.audit);
  const module: RuntimeModule<Record<string, never>> = {
    definition: feesModuleDefinition,
    handlers: createFeesHandlers({
      repo,
      directory: deps.peopleDirectory,
      scopeChecker: deps.scopeChecker,
      enqueueGenerate: deps.enqueueGenerate,
    }),
    jobProcessors: {
      [INVOICE_GENERATE_JOB_NAME]: createGenerateProcessor(repo, deps.peopleDirectory),
    },
    readinessChecks: [],
    service: {},
  };
  assertModuleWiring(module);
  return module;
}
