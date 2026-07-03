# Foundation threat model (Vidya #1)

Scope: the monolith skeleton — module system, http pipeline, worker, audit
log, migration harness, local compose stack. Student/teacher data does not
exist yet; the assets at risk are the audit trail, infrastructure
credentials, and the integrity of the boundary/enforcement machinery that
later modules will rely on.

## Assets

1. `sys_audit_log` integrity (the platform's evidence store).
2. Database/Redis/MinIO credentials and connectivity.
3. The deny-by-default posture (nothing must accidentally become reachable).
4. CI/enforcement integrity (lint, ownership check, OpenAPI sync, coverage).

## Trust boundaries

- Internet/institution network → web replicas (rewrites + /api/v1).
- Scrape network → /metrics (web + worker :9464).
- Application → Postgres/Redis/MinIO (private network).
- Developer laptop / CI → migration runner (DDL-privileged).

## STRIDE

| Threat | Vector | Mitigation (now) | Residual / planned |
|---|---|---|---|
| **S**poofing | Forged identity on API routes | No credentials exist; DenyAllAuthenticator answers 401 to every non-public route. Public trio exposes no tenant data. | #2 sessions in Redis; session fixation/rotation to be threat-modeled then. |
| Spoofing | Forged `x-request-id` to pollute correlation | Charset+length allowlist; otherwise replaced by UUID. | Accept-listed proxies could be given a signed header later. |
| **T**ampering | Rewriting audit history | DB-level append-only (UPDATE/DELETE row triggers + TRUNCATE trigger); writes only through the module service; integration-tested. | A superuser can drop triggers: mitigate operationally (restricted DB roles — see gaps) and via pgaudit/WAL archiving later. |
| Tampering | Malicious/buggy migration | Paired rollbacks mandatory; journal drift detection; advisory lock; ADR-0008 human review; CI proves up/down/up. | Runner runs with DDL rights by necessity; production runs it as a separate one-shot step, not from web/worker runtime. |
| Tampering | Job payload injection via Redis | Payloads zod-validated before processors; unknown job names rejected; Redis is on the private network. | Redis AUTH/TLS not yet configured in compose (gap below). |
| **R**epudiation | State change without a trace | `defineRoute` refuses to build state-changing routes lacking an audit declaration; audit write failure fails the request (fail-closed); heartbeat proves the worker path writes audit too. | Actor is null until #2 provides principals. |
| **I**nfo disclosure | Error responses leaking internals | problem+json envelope: no stacks, no dependency strings; readiness returns names + booleans only (errors go to logs); 500 detail suppressed (unit-tested). | — |
| Info disclosure | Secrets in logs/repo | Config errors print variable names, never values (unit-tested); pino redaction paths; `.env` git-ignored; compose uses overridable local-dev-only defaults. | Secret rotation/scanning is an ops concern; recommend gitleaks in CI (debt). |
| Info disclosure | /metrics reveals topology/timings | Documented requirement: restrict to scrape network (route spec + runbook). | Consider mTLS or bearer scrape auth on-prem. |
| **D**oS | Oversized/hostile request bodies | zod rejects unknown shapes; no body-size middleware yet (gap below — Next default limits apply). | Rate limiting & explicit body-size caps land with the first authenticated write route (#2). |
| DoS | Readiness checks hammering dependencies | 2s per-check timeout; checks are two cheap pings. | Probe frequency governed by orchestrator. |
| **E**oP | Reaching a "not built yet" route | Deny-by-default is structural: non-public routes 401 before any handler code; public requires an explicit justified flag; route files can only import the composition root (lint), so no route can bypass the pipeline. | #2's scope-check is the next privilege boundary; flagged for near-exhaustive branch coverage. |
| EoP | Module escaping its boundary (deep import / foreign table) | Lint (verified by violation probes), package exports, ownership CI check. | Heuristic SQL scan; reviewer vigilance for dynamic SQL. |
| EoP | Container escape / lateral movement | Non-root (`USER node`) in both images; no privileged flags; single-purpose containers. | Read-only root FS + dropped capabilities recorded as hardening debt. |

## Explicitly out of scope until #2+

Authentication, sessions, CSRF (no cookie auth exists), authorization,
multi-tenancy, PII handling. Each arrives with its own threat-model delta.
