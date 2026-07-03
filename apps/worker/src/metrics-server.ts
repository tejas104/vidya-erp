import { createServer, type Server } from "node:http";
import type { Logger, Metrics, ReadinessCheck } from "@vidya/platform";

export interface MetricsServerOptions {
  readonly port: number;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly checks: readonly ReadinessCheck[];
  readonly isDraining: () => boolean;
}

export interface MetricsServerHandle {
  readonly server: Server;
  close(): Promise<void>;
}

/**
 * Minimal observability listener for the worker replica (the worker serves
 * no application API, but Constitution rules 8–9 require every replica to
 * be probeable and scrapeable). Endpoints: /health, /ready, /metrics.
 */
export function createMetricsServer(options: MetricsServerOptions): MetricsServerHandle {
  const server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "/";
      if (request.method !== "GET") {
        response.writeHead(405).end();
        return;
      }
      if (url === "/health") {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));
        return;
      }
      if (url === "/ready") {
        if (options.isDraining()) {
          response
            .writeHead(503, { "content-type": "application/json" })
            .end(JSON.stringify({ status: "draining", checks: [] }));
          return;
        }
        const results = await Promise.all(
          options.checks.map(async (check) => {
            try {
              await check.check();
              return { name: check.name, ok: true };
            } catch (error) {
              options.logger.warn({ check: check.name, err: error }, "readiness check failed");
              return { name: check.name, ok: false };
            }
          }),
        );
        const allOk = results.every((result) => result.ok);
        response
          .writeHead(allOk ? 200 : 503, { "content-type": "application/json" })
          .end(JSON.stringify({ status: allOk ? "ready" : "unready", checks: results }));
        return;
      }
      if (url === "/metrics") {
        const body = await options.metrics.registry.metrics();
        response
          .writeHead(200, { "content-type": options.metrics.registry.contentType })
          .end(body);
        return;
      }
      response.writeHead(404).end();
    })().catch((error) => {
      options.logger.error({ err: error }, "metrics server request failed");
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });

  server.listen(options.port, () => {
    options.logger.info({ port: options.port }, "worker observability server listening");
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
