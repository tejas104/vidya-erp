import type { Principal, RouteHandler, ScopeChecker } from "@vidya/platform";
import type { TermsRepo } from "./repo";
import type { AssessmentTypesRepo } from "./assessment-types-repo";
import { AssessmentConfigurationError, assessmentTypesInputSchema } from "./assessment-types";
import { termRef } from "./resource-refs";

export function createAssessmentTypesHandlers(deps: { terms: TermsRepo; types: AssessmentTypesRepo; scopeChecker: ScopeChecker }): Record<string, RouteHandler> {
  function handler(write: boolean): RouteHandler {
    return async (ctx) => {
      const principal = ctx.principal as Principal;
      const { termId } = ctx.request.params as { termId: string };
      const term = await deps.terms.get(termId);
      if (!term) return { status: 404, body: { message: "no such term" } };
      // ADR-0024: the shared checker owns containment; the module owns only
      // the administrator role predicate. Stored term position is authoritative.
      if (!deps.scopeChecker.check(principal, "read", termRef(term)).granted) {
        return { status: 403, body: { message: "access denied" } };
      }
      if (!write) return { status: 200, body: { types: await deps.types.list(termId), locked: term.scaleId !== null } };
      if (!principal.roles.includes("admin")) return { status: 403, body: { message: "only administrators can configure assessment types" } };
      if (term.status !== "open") return { status: 409, body: { message: "Reopen the term before changing assessment types." } };
      const parsed = assessmentTypesInputSchema.safeParse(ctx.request.body);
      if (!parsed.success) return { status: 422, body: { message: parsed.error.issues[0]?.message ?? "invalid assessment configuration" } };
      try {
        const saved = await deps.types.replace(termId, parsed.data.types);
        return { status: 200, body: { types: saved.types }, audit: { org: termRef(term).org, resourceId: termId, details: { before: saved.before, after: saved.types } } };
      } catch (caught) {
        if (caught instanceof AssessmentConfigurationError) return { status: 409, body: { message: caught.message } };
        throw caught;
      }
    };
  }
  return { "school-academics.types-list": handler(false), "school-academics.types-set": handler(true) };
}
