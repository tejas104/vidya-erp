# syntax=docker/dockerfile:1
# Vidya web process. Multi-stage: install + next build (standalone output),
# then a minimal non-root runtime containing only traced files.

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests first so dependency install caches independently of source edits.
#
# ALL workspace package.json files must land here before `pnpm install
# --frozen-lockfile` runs, not just the ones this app imports directly: the
# lockfile is one unified file for the whole pnpm workspace
# (pnpm-workspace.yaml: apps/*, packages/*, packages/modules/*), so pnpm
# resolves and links every importer's dependencies in one pass. A previous
# version of this list only copied platform/system/identity, which left
# every other module's runtime deps (prom-client chief among them, pulled in
# by @vidya/platform and re-declared by academics/analytics/people/reporting)
# unlinked — the app then failed at runtime with "Cannot find package
# 'prom-client'" even though the build itself appeared to succeed. See
# docs/install-guide.md troubleshooting #1.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/operator/package.json apps/operator/
COPY packages/control-plane/package.json packages/control-plane/
COPY packages/platform/package.json packages/platform/
COPY packages/ui-system/package.json packages/ui-system/
COPY packages/modules/academics/package.json packages/modules/academics/
COPY packages/modules/analytics/package.json packages/modules/analytics/
COPY packages/modules/coursework/package.json packages/modules/coursework/
COPY packages/modules/exams/package.json packages/modules/exams/
COPY packages/modules/fees/package.json packages/modules/fees/
COPY packages/modules/identity/package.json packages/modules/identity/
COPY packages/modules/leave/package.json packages/modules/leave/
COPY packages/modules/notices/package.json packages/modules/notices/
COPY packages/modules/people/package.json packages/modules/people/
COPY packages/modules/portal/package.json packages/modules/portal/
COPY packages/modules/reporting/package.json packages/modules/reporting/
COPY packages/modules/results/package.json packages/modules/results/
COPY packages/modules/school-academics/package.json packages/modules/school-academics/
COPY packages/modules/syllabus/package.json packages/modules/syllabus/
COPY packages/modules/system/package.json packages/modules/system/
COPY packages/modules/timetable/package.json packages/modules/timetable/
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
