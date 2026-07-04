import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Monorepo: trace files from the workspace root so the standalone output
  // includes the workspace packages.
  outputFileTracingRoot: repoRoot,
  // Workspace packages ship TypeScript source; Next transpiles them.
  transpilePackages: ["@vidya/platform", "@vidya/module-system", "@vidya/module-identity"],
  // Infrastructure clients with native/dynamic requires stay external to the
  // server bundle.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "bullmq",
    "ioredis",
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
