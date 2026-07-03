import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

/**
 * Vidya lint configuration. The boundary rules ARE the Constitution
 * (rules 1–3) in executable form — they fail the build, they are not
 * advisory. See docs/adr/0006-eslint-plugin-boundaries.md.
 */

const CONSTITUTION_MESSAGE =
  "Cross-module boundary violation (Constitution rules 1-3): modules interact only through another module's public index.ts API.";

/** Deep imports into any module's internals are banned everywhere. */
const deepImportPatterns = [
  {
    group: ["@vidya/module-*/*", "!@vidya/module-*/package.json"],
    message:
      "Deep import into a module's internals (Constitution rule 3). Import the module's public API from its package root.",
  },
  {
    group: ["@vidya/platform/*", "!@vidya/platform/package.json"],
    message: "Import @vidya/platform from its package root.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "coverage/**",
      "docs/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": ["error", { patterns: deepImportPatterns }],
    },
  },
  {
    // The platform never imports feature modules — not even their public APIs.
    files: ["packages/platform/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...deepImportPatterns,
            {
              group: ["@vidya/module-*"],
              message:
                "The platform layer never imports feature modules (Constitution rules 1-3); composition roots in apps/ wire modules together.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": import.meta.dirname,
      "boundaries/elements": [
        // Order matters: first match wins, so public entrypoints precede
        // the module-internal catch-all.
        {
          type: "module-public",
          mode: "file",
          pattern: "packages/modules/*/src/index.ts",
          capture: ["moduleName"],
        },
        {
          type: "module-internal",
          mode: "file",
          pattern: "packages/modules/*/src/**/*",
          capture: ["moduleName"],
        },
        { type: "platform", mode: "file", pattern: "packages/platform/src/**/*" },
        { type: "web-composition", mode: "file", pattern: "apps/web/src/composition.ts" },
        { type: "web-route", mode: "file", pattern: "apps/web/app/**/route.ts" },
        { type: "web-app", mode: "file", pattern: "apps/web/**/*" },
        { type: "worker-app", mode: "file", pattern: "apps/worker/**/*" },
        { type: "scripts", mode: "file", pattern: "scripts/**/*" },
        { type: "tests", mode: "file", pattern: "tests/**/*" },
        { type: "root-config", mode: "full", pattern: ["*.ts", "*.mjs"] },
      ],
      "import/resolver": {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: [
            "tsconfig.json",
            "apps/web/tsconfig.json",
            "apps/worker/tsconfig.json",
            "packages/platform/tsconfig.json",
            "packages/modules/*/tsconfig.json",
          ],
        },
      },
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          message: CONSTITUTION_MESSAGE,
          rules: [
            // Platform is self-contained.
            { from: ["platform"], allow: ["platform"] },
            // A module may use itself, the platform, and other modules'
            // PUBLIC APIs only.
            {
              from: ["module-internal", "module-public"],
              allow: [
                ["module-internal", { moduleName: "${from.moduleName}" }],
                ["module-public", { moduleName: "${from.moduleName}" }],
                "module-public",
                "platform",
              ],
            },
            // Route files are thin: they may import ONLY the composition
            // root (which applies the defineRoute pipeline). This is what
            // makes "every route goes through auth/audit/validation"
            // structurally enforceable.
            { from: ["web-route"], allow: ["web-composition"] },
            {
              from: ["web-composition", "web-app"],
              allow: ["platform", "module-public", "web-app", "web-composition"],
            },
            { from: ["worker-app"], allow: ["platform", "module-public", "worker-app"] },
            {
              from: ["scripts", "tests", "root-config"],
              allow: ["platform", "module-public", "scripts", "tests", "root-config"],
            },
          ],
        },
      ],
    },
  },
);
