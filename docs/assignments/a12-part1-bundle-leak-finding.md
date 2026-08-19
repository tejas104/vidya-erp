# #12 Part 1 — the release bundle leaks source and internal documents

**Status: CLOSED 2026-08-19.** Fixed across three commits — `ff13685` (scripts stop building on the client), `3aa9343` (bundle trimmed to an allow-list + regression guard + `image:` keys). Verified: the registry-mode tarball is now **20 entries / 38 KB**, down from **1,310 entries / 822 MB**, containing only the intended manifest. No source, no internal documents, no secrets. The original analysis below is kept because it explains why the fix had to be done as one coherent change rather than a one-line trim.

## What the bundle currently contains

`releases/vidya-0.1.0.tar.gz` is built with `git archive`, so it ships **1,310 entries**:

- 186 TypeScript module source files (`packages/**`, `apps/**`)
- `.github/workflows/ci.yml`
- **67 internal engineering documents**, including:
  - `docs/security-review.md`
  - `docs/audits/2026-07-audit.md`
  - `docs/threat-model*.md`
  - every ADR under `docs/adr/`
  - `docs/superpowers/plans/*`, including the ERP master plan
  - `docs/NEXT-SESSION.md`

This is a product sold to colleges. Shipping our own threat models and security review to every customer hands an attacker a map of where to look; shipping the master plan and internal handoff notes is a commercial exposure. Neither was asked for — the assignment specified an explicit content list.

Confirmed by listing the built artefact, not inferred.

## Why it is not a one-line fix

Trimming `build-release.sh` alone would produce a bundle that **cannot install**. Three things depend on the source tree being present:

1. **`install.sh:269,280` and `update.sh:173,217` run `docker compose up -d --build`.** They compile images on the client from source. The assignment asked for images to be *shipped* — registry pull, or `docker save` tarballs for offline — not built on site. Building on the client also defeats offline install (the build still needs npm registry access) and is slow and fragile on a modest 4-core client box.
2. **Both Dockerfiles `COPY . .`** before `pnpm install --frozen-lockfile`, so the build context must contain the workspace.
3. **`install.sh` step 4 and `update.sh` step 3 run `npx tsx scripts/license-issue.ts` on the HOST**, before any container exists. That imports `@vidya/platform`, which only resolves with `packages/platform` and a workspace `node_modules` present at the install root.

Point 3 is the subtle one and is easy to miss: licence verification at install time is a *host* operation today, not a container one.

## The fix, when it is done

Do all of it together — a trimmed bundle without the script changes is worse than the leak, because it fails at the client instead of merely over-sharing.

1. `install.sh` / `update.sh`: `docker load` the saved image tarballs (offline) or `docker compose pull` (registry). **No `--build` fallback** — a silent fallback recreates the problem.
2. Give licence verification a host-independent path: run the verifier *inside* a container, or ship a small standalone verifier that does not need the workspace. It must still consume the human-authored verifier as a black box and contain no signature logic.
3. `build-release.sh`: package an explicit allow-list — compose files, `Caddyfile`, `install.sh`, `update.sh`, `.env.template`, the operator guides, `deployment-checklist.md`, `runbook-backup-restore.md`, backup/restore scripts, the `license/` slot + README, `package.json` (`update.sh:73` requires it at the bundle root, alongside `docker-compose.yml`), the image payload, and a VERSION/manifest with version + git SHA.
4. Add a build-time guard that fails the build if the tarball contains any `.ts`/`.tsx` or any excluded doc path. A leak this consequential should be caught by the tool that creates it.

## Outcome

All four steps landed:

1. `install.sh`/`update.sh` obtain images via `docker load` (offline) or `docker compose pull` (registry). **No `--build` anywhere**, and a loud failure naming the missing images if neither source works. `install.sh` no longer needs Node.js on the host.
2. Licence verification runs inside a throwaway container from the **worker** image — not `web`, which is a standalone Next build carrying neither `scripts/` nor `tsx`. It reuses the pattern `install.sh` already used for `create-admin.ts`, and still contains no signature or parsing logic of its own.
3. `build-release.sh` packages an explicit allow-list; `package.json` and `docker-compose.yml` remain at the bundle root, so `update.sh`'s existing check still passes.
4. A build-time guard fails the build if any `.ts`/`.tsx` or excluded doc path reaches the tarball — **proven by firing it**, not merely written: injecting `scripts/migrate.ts` into the manifest failed the build (exit 1, previous good tarball untouched); removing it passed.

`docker-compose.yml` gained `image:` keys for `web`/`worker`/`migrate` so the registry path has a target, with `build:` retained so local development is unchanged. Both base and prod-overlay `docker compose config` validate.

## Still unverified

- Offline mode at the ~0.4 GB free-RAM floor this machine sometimes sits at. It built successfully at ~1.6 GB free; the low-memory case is untested, not known-broken.
- A real registry push/pull round trip — no registry available here.
- A full interactive `install.sh` run on a clean server. That is #12 Part 5, and it remains the only thing that proves the bundle end to end.
