/**
 * @vidya/module-exams — PUBLIC API (the only importable surface).
 *
 * The exam timetable on the noticeboard: series hold dated slots; slot
 * creation warns (never blocks) on room clashes against the weekly timetable;
 * students read their own schedule and the reporting module renders their
 * hall ticket through an injected source.
 */

import {
  assertModuleWiring,
  type AuditLogger,
  type Db,
  type RuntimeModule,
} from "@vidya/platform";
import type { PeopleDirectory } from "@vidya/module-people";
import type { TimetableReadModel } from "@vidya/module-timetable";
import { examsModuleDefinition } from "./definition";
import { createExamsHandlers, createHallTicketSource, type HallTicketSource } from "./handlers";
import { createExamsRepo } from "./repo";

export { MODULE_NAME as EXAMS_MODULE_NAME, examsModuleDefinition } from "./definition";
export type { HallTicketData, HallTicketResult, HallTicketSource } from "./handlers";

export interface ExamsModuleDeps {
  readonly db: Db;
  readonly audit: AuditLogger;
  readonly peopleDirectory: PeopleDirectory;
  readonly timetableRead: TimetableReadModel;
}

export interface ExamsService {
  /** Hall ticket with its own access decision (injected into reporting). */
  readonly hallTicket: HallTicketSource;
}

export function createExamsModule(deps: ExamsModuleDeps): RuntimeModule<ExamsService> {
  const repo = createExamsRepo(deps.db);
  const module: RuntimeModule<ExamsService> = {
    definition: examsModuleDefinition,
    handlers: createExamsHandlers({ repo, directory: deps.peopleDirectory, timetable: deps.timetableRead }),
    jobProcessors: {},
    readinessChecks: [],
    service: { hallTicket: createHallTicketSource({ repo, directory: deps.peopleDirectory }) },
  };
  assertModuleWiring(module);
  return module;
}
