import { describeScopeCheckerConformance } from "./conformance/scope-checker";
import { createScopeChecker } from "./scope-checker";

describeScopeCheckerConformance("grant-matrix checker", () => createScopeChecker());
