# syntax=docker/dockerfile:1
# Vidya web process. Multi-stage: install + next build (standalone output),
# then a minimal non-root runtime containing only traced files.

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests first so dependency install caches independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/platform/package.json packages/platform/
COPY packages/modules/system/package.json packages/modules/system/
COPY packages/modules/identity/package.json packages/modules/identity/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @vidya/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
# Hand SIGTERM to the application (composition root drains via /ready, then
# closes pools) instead of Next's default handler. See docs/runbook.md.
ENV NEXT_MANUAL_SIG_HANDLE=true
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
