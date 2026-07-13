/**
 * @vidya/module-results — PUBLIC API (the only importable surface).
 *
 * The printed marksheet: grade scales, per-class subject credits, live
 * SGPA/CGPA computation (academics marks read model × credits × scale) and a
 * hard publication gate — students see nothing until the principal publishes.
 * Nothing computed is stored; a published term stays reproducible because the
 * scale it used is frozen (RESTRICT) and marks are already audited.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type RuntimeModule,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { AcademicsReadModel } from "@vidya/module-academics";
import { resultsModuleDefinition } from "./definition";
import { createResultsHandlers } from "./handlers";
import { createGradeCardSource, type GradeCardSource } from "./compute";
import { createResultsRepo, type ResultsRepo } from "./repo";

export { MODULE_NAME as RESULTS_MODULE_NAME, resultsModuleDefinition } from "./definition";
export { bandFor, cgpa, meanPct, sgpa, type Band } from "./gpa";
export type { GradeCardData, GradeCardResult, GradeCardSource, TermResultView } from "./compute";

export interface ResultsModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly peopleDirectory: PeopleDirectory;
  readonly marksReadModel: AcademicsReadModel;
}

/** Read surface for the reporting module's grade-card kind (R4). */
export interface ResultsService {
  readonly repo: ResultsRepo;
  /** Published-only grade card with its own access decision (injected into reporting). */
  readonly gradeCard: GradeCardSource;
}

export function createResultsModule(deps: ResultsModuleDeps): RuntimeModule<ResultsService> {
  const repo = createResultsRepo(deps.db);
  const shared = { repo, directory: deps.peopleDirectory, marks: deps.marksReadModel };
  const module: RuntimeModule<ResultsService> = {
    definition: resultsModuleDefinition,
    handlers: createResultsHandlers(shared),
    jobProcessors: {},
    readinessChecks: [],
    service: { repo, gradeCard: createGradeCardSource(shared) },
  };
  assertModuleWiring(module);
  return module;
}
