/**
 * Local barrel for the S02 attendance-summary calculation engine.
 *
 * Not re-exported from the package's public `../index.ts` and not wired
 * into any handler, route, or module composition — this round ships the
 * pure calculation only. A later, reviewed assignment integrates it.
 */
export * from "./contract";
export { summarizeAttendance } from "./calculate";
