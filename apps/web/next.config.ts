import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Deployed-version stamp shown on the admin System page (license register's
// "deployed version" column). Version comes from the root package.json; the
// git SHA is passed in as GIT_SHA at build time (Docker), or read from git for
// local dev, or "unknown" if neither is available.
const require = createRequire(import.meta.url);
const appVersion = (require(path.join(repoRoot, "package.json")) as { version: string }).version;
function resolveGitSha(): string {
  if (process.env.GIT_SHA && process.env.GIT_SHA !== "unknown") return process.env.GIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot }).toString().trim();
  } catch {
    return "unknown";
  }
}
const gitSha = resolveGitSha();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Inlined into the client bundle at build time (version is not a secret).
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_SHA: gitSha,
  },
  // Monorepo: trace files from the workspace root so the standalone output
  // includes the workspace packages.
  outputFileTracingRoot: repoRoot,
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: [
    "@vidya/platform",
    "@vidya/ui-system",
    "@vidya/module-system",
    "@vidya/module-identity",
    "@vidya/module-people",
    "@vidya/module-academics",
    "@vidya/module-analytics",
    "@vidya/module-reporting",
  ],
  // Infrastructure clients with native/dynamic requires stay external to the
  // server bundle. pdfkit (report PDF rendering, worker-only) is a CJS package
  // with heavy transitive deps (fontkit) — kept external so Turbopack doesn't
  // compile it (which emits an @swc/helpers decorator helper Next's pinned
  // copy doesn't re-export) and it is `require`d at runtime instead.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "bullmq",
    "ioredis",
    "pdfkit",
    "pg",
    "pino",
    "prom-client",
  ],
  async rewrites() {
    // Constitution rule 5 (every route versioned) and rule 8 (conventional
    // probe paths) both hold: canonical handlers live under /api/v1/system,
    // the bare paths are aliases for probes and Prometheus.
    return [
      { source: "/health", destination: "/api/v1/system/health" },
      { source: "/ready", destination: "/api/v1/system/ready" },
      { source: "/metrics", destination: "/api/v1/system/metrics" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
