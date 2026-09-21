# School browser-test environment

Run the real T03/T04 school journeys with one command:

```powershell
pnpm test:e2e:school
```

The runner creates Compose project `vidya-school-e2e` only. Its Postgres,
Redis, MinIO, database, volumes, and web port are deliberately separate from
ordinary local development and integration resources:

| Resource | School E2E value |
| --- | --- |
| Postgres / database | `127.0.0.1:55435` / `vidya_school_e2e` |
| Redis | `127.0.0.1:6385` |
| MinIO / console | `127.0.0.1:9010` / `127.0.0.1:9011` |
| production web server | `127.0.0.1:3115` |
| Compose volumes | `vidya-school-e2e_school-e2e-*` |

It migrates that database, runs `scripts/seed-school-e2e.ts` (a deterministic
school bootstrap account and implicit school department), compiles the school
help map, builds the production web server with `VIDYA_EDITION=school`, and
runs exactly `tests/e2e/school/terms.spec.ts` and
`tests/e2e/school/marks.spec.ts`. The journeys add their own unique term and
assessment data; this is disposable browser data, not the normal `seed:demo`
dataset.

The runner stops its web process and then verifies the Compose-project and
`com.vidya.school-e2e=true` labels, plus the selected database name, before it
removes containers and volumes. It does not touch a resource it cannot prove
belongs to this test environment. Failure traces, screenshots, and reports in
`test-results/` or `playwright-report/` are intentionally retained.

Cleanup is safe to repeat:

```powershell
pnpm test:e2e:school:cleanup
pnpm test:e2e:school:cleanup
```
