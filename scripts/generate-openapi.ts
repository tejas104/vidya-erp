import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { z, type AnyZodObject } from "zod";
import type { RouteSpec } from "@vidya/platform";
import { moduleDefinitions } from "./registry";

/**
 * Generates docs/openapi/openapi.json from the RouteSpecs every module
 * declares — the same zod schemas that validate requests at runtime, so the
 * spec cannot drift from enforcement. CI runs `--check` to fail when the
 * committed artifact is stale.
 */

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "openapi",
  "openapi.json",
);

function responseContent(spec: RouteSpec, status: number) {
  const response = spec.responses[status];
  if (response === undefined) {
    throw new Error(`route ${spec.id}: missing response spec for status ${status}`);
  }
  if (response.schema === undefined && response.contentType === undefined) {
    return { description: response.description };
  }
  return {
    description: response.description,
    content: {
      [response.contentType ?? "application/json"]: {
        schema: response.schema ?? z.string(),
      },
    },
  };
}

function toRouteConfig(spec: RouteSpec): RouteConfig {
  const authNote = spec.auth.public
    ? `**Public route** (no authentication): ${spec.auth.reason}`
    : "**Requires authentication.** Until Vidya #2 ships the session authenticator, every request receives 401 (deny-by-default gate).";
  const responses: RouteConfig["responses"] = {};
  for (const status of Object.keys(spec.responses)) {
    responses[status] = responseContent(spec, Number(status));
  }
  if (!spec.auth.public) {
    responses["401"] ??= { description: "Authentication required (problem+json)" };
    responses["403"] ??= { description: "Access denied by the role/scope policy (problem+json)" };
  }
  return {
    method: spec.method.toLowerCase() as Lowercase<RouteSpec["method"]>,
    path: spec.path,
    summary: spec.summary,
    description: [spec.description, authNote].filter(Boolean).join("\n\n"),
    tags: [...spec.tags],
    security: spec.auth.public ? [] : [{ sessionAuth: [] }],
    request:
      spec.request?.query !== undefined
        ? { query: spec.request.query as AnyZodObject }
        : spec.request?.body !== undefined
          ? {
              body: {
                content: { "application/json": { schema: spec.request.body } },
              },
            }
          : undefined,
    responses,
  };
}

export function buildOpenApiDocument(): unknown {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "sessionAuth", {
    type: "apiKey",
    in: "cookie",
    name: "vidya_session",
    description:
      "Redis-backed session (contract defined in Vidya #1, implemented in Vidya #2). Until then, authenticated routes always return 401.",
  });
  for (const definition of moduleDefinitions) {
    for (const route of definition.routes) {
      registry.registerPath(toRouteConfig(route));
    }
  }
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Vidya API",
      version: "0.1.0",
      description:
        "On-premise College Information & Analytics System. All routes are versioned under /api/v1. The bare /health, /ready and /metrics paths are rewrites of the system module's routes.",
    },
    servers: [{ url: "/" }],
  });
}

async function main(): Promise<void> {
  const document = buildOpenApiDocument();
  const rendered = `${JSON.stringify(document, null, 2)}\n`;
  const checkMode = process.argv.includes("--check");
  if (checkMode) {
    let existing: string;
    try {
      existing = await readFile(OUTPUT_PATH, "utf8");
    } catch {
      console.error(`OpenAPI spec missing at ${OUTPUT_PATH}; run \`pnpm openapi:generate\``);
      process.exit(1);
    }
    if (existing !== rendered) {
      console.error("OpenAPI spec is stale; run `pnpm openapi:generate` and commit the result");
      process.exit(1);
    }
    console.log("OpenAPI spec is up to date");
    return;
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, rendered, "utf8");
  console.log(`wrote ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error("openapi generation failed:", error);
  process.exit(1);
});
