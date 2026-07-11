// Brings @testing-library/jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveAttribute, …) into scope for the .test.tsx files, which the web
// tsconfig compiles. The runtime registration lives in test/setup-ui.ts; this
// is the type-only counterpart so `tsc --noEmit` sees the extended matchers.
import "@testing-library/jest-dom/vitest";
