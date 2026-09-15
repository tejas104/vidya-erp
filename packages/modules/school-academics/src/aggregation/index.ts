/**
 * Local barrel for the S01 weighted-result calculation engine.
 *
 * Not re-exported from the package's public `../index.ts` and not wired
 * into any handler or module composition — this round ships the pure
 * calculation only. A later, reviewed assignment integrates it.
 */
export * from "./contract";
export { calculateWeightedResult } from "./calculate";
