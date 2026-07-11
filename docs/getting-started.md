# Getting started — running a Vidya pilot

This is the shortest path from a clean machine to a running Vidya you can log
into, seed with demo data, and generate a scoped report from. It covers a
local **evaluation** stack via Docker Compose, then the notes that turn it
into a real **pilot** (your own college, no demo data) and what MUST change
before production.

> The compose stack serves plain HTTP on `localhost` with local-dev secrets.
> It is for evaluation and pilots on a trusted network — **not** the internet.
> See "Before production" below and `docs/runbook.md`.

## Prerequisites

- Docker + Docker Compose (the only requirement for the evaluation path).
- For running the repo's scripts (`create-admin`, `seed:demo`) directly on the
  host instead of inside a container: Node 22 + pnpm 11, and `pnpm install`.

## 1. Bring the stack up

```bash
cp .env.example .env          # optional — compose already has local defaults
docker compose up --build -d
```

This starts Postgres, Redis and MinIO, runs the **migrations** automatically
(the `migrate` service completes before web/worker start — ADR-0008), then the
`web` and `worker` replicas. When it settles:

- Web app: <http://localhost:3000>
- Worker metrics: <http://localhost:9464/metrics>
- MinIO console: <http://localhost:9001> (artifacts land in the `vidya` bucket)

Check health:

```bash
curl -s http://localhost:3000/api/v1/system/health   # {"status":"ok",...}
docker compose ps                                     # all services "healthy"
```

## 2. Seed the demo dataset (evaluation)

The demo seeder builds a whole college — departments, classes, sections,
subjects, teachers, students, attendance and marks — by driving the **real**
authenticated, scope-checked, audited chain (#2 → #3 → #4), exactly as the app
does. It is self-contained: it creates its own `DEMO` college and a dedicated
demo admin. It refuses unless you explicitly allow it and the environment is
not production (ADR-0020 / `scripts/seed-demo.ts`).

Run it **inside the compose network** (no host toolchain needed). The worker
image runs as `NODE_ENV=production`, so override it — you are asserting this is
a throwaway database:

```bash
docker compose run --rm \
  -e NODE_ENV=development \
  -e VIDYA_ALLOW_DEMO_SEED=true \
  worker apps/worker/node_modules/.bin/tsx scripts/seed-demo.ts
```

<details>
<summary>Or from the host, against the published ports</summary>

With `.env` pointing at `localhost` (the defaults do) and `pnpm install` done:

```bash
VIDYA_ALLOW_DEMO_SEED=true pnpm seed:demo
```
</details>

The seeder prints a **credential table** at the end — one row per role, with
the sign-in username, password (demo-only) and that account's scope. Re-running
it is safe: it detects the already-seeded tree and just reprints the
credentials rather than duplicating anything.

## 3. Log in and watch the permission mirror

Open <http://localhost:3000> and sign in as each printed account in turn:

- **`demo-principal`** — sees every department (college-wide).
- **`demo-hod-cse`** — sees only the Computer Science department.
- **`demo-ct-fycs`** (class teacher) — sees the whole class, all subjects, and
  is the one who can record attendance.
- **`demo-teacher-ds` / `-mth` / `-dbms`** — each sees only their own subject in
  the class; the cross-subject "overall" is withheld from them by design.

The dashboard shows **only** what that account's scope permits — rooms outside
scope simply do not appear, and any cohort under 5 students is shown as a
withheld-cohort note, never a number (ADR-0018).

## 4. Generate a scoped report

As **`demo-ct-fycs`** (or the admin), open a student from the dashboard's
"Needs attention" list (or any student page). Use **Download report (PDF)** or
**Export (CSV)**:

1. the request is scope-checked before it is accepted (a target outside your
   scope is refused);
2. the worker generates the artifact with *your* scope snapshot;
3. the download link is re-checked server-side — only you, the requester, can
   fetch it (the URL is not a secret capability).

Open the CSV in a spreadsheet: any name that starts with a formula character is
stored as text, not executed (CSV-injection escaping, ADR-0020).

## Running a real pilot (your own college, no demo data)

Skip the seeder. Bootstrap your real college and its first admin, then do
everything else through the UI:

```bash
docker compose run --rm \
  -e VIDYA_ADMIN_PASSWORD='choose-a-strong-password' \
  worker apps/worker/node_modules/.bin/tsx scripts/create-admin.ts \
  --username your-admin --display-name "Your Name" \
  --college-name "Your College" --college-code MAIN
```

Sign in as that admin to build the org tree, create users and assign teachers
(assignments derive their scope grants automatically — ADR-0015). Bulk student
/ teacher onboarding uses the CSV import under the people module.

> College creation is intentionally CLI-only for now (`bootstrapCollege`);
> multi-college self-service is out of the MVP by the assignment's deferral
> list. This is a ratified parked decision — see docs/review-gate-6.md.

## Before production

The compose defaults are **not** production-safe. At minimum:

- Put the web replica behind TLS and set `SESSION_COOKIE_SECURE=true`.
- Replace every `local-dev-only-*` secret (Postgres, MinIO, `TRUSTED_ORIGINS`)
  with real, secret-manager-injected values; never commit them.
- Give Redis AUTH + network isolation (it holds sessions), and lock down
  Postgres/MinIO (TLS + credentials, restricted DB roles).
- Review `docs/runbook.md` (graceful shutdown, backups, scaling) and
  `docs/security-review.md` (the open ASVS gaps and the secrets posture).

## Tearing down

```bash
docker compose down          # stop; keep data volumes
docker compose down -v       # stop and DELETE all data (fresh start)
```
