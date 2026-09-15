/**
 * Local barrel for the S03 guardian-access proposal.
 *
 * Not re-exported from the people module's public `../index.ts` and not
 * wired into any handler, route, or module composition — this is a design
 * proposal (types + conformance case data), not an implementation. See
 * docs/architecture/guardian-access/README.md for the full proposal, and
 * that directory's open-decisions.md for what remains for the identity
 * owner to decide before any of this is built.
 */
export * from "./types";
export * from "./cases";
