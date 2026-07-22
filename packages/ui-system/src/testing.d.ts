// Brings @testing-library/jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveAttribute, toHaveTextContent, …) into scope for the package's
// .test.tsx files, which this package's tsconfig compiles. The runtime
// registration lives in the vitest ui-project setup (apps/web/test/setup-ui.ts);
// this is the type-only counterpart so `tsc --noEmit` sees the extended matchers.
import "@testing-library/jest-dom/vitest";
