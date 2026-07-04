# syntax=docker/dockerfile:1
# Vidya worker process. Runs TypeScript sources through tsx (ADR-0009);
# tsc --noEmit in CI guarantees type-safety of exactly these sources.
# Also used by docker-compose's one-shot migrate service.

FROM node:22-alpine
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/platform/package.json packages/platform/
COPY packages/modules/system/package.json packages/modules/system/
COPY packages/modules/identity/package.json packages/modules/identity/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9464/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/main.ts"]
