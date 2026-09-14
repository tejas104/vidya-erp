# syntax=docker/dockerfile:1
# Vidya worker process. Runs TypeScript sources through tsx (ADR-0009);
# tsc --noEmit in CI guarantees type-safety of exactly these sources.
# Also used by docker-compose's one-shot migrate service.

FROM node:22-alpine
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ALL workspace package.json files must land here before `pnpm install
# --frozen-lockfile` runs, not just the ones this app imports directly — see
# the matching comment in apps/web/Dockerfile (same fix, same root cause:
# "Cannot find package 'prom-client'" at runtime, docs/install-guide.md
# troubleshooting #1).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
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

ENV NODE_ENV=production
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9464/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/main.ts"]
