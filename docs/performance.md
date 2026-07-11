# Performance review — Vidya #1 foundation + #2 identity

## Rollups at college scale (#5)

- **Nightly rebuild** pages every attendance entry and mark of the year
  through #4's read model (keyset, 5k/page), folds them in a single pass
  into per-node accumulators (section→college attendance, class→college
  marks, YTD + monthly), then writes atomically per year (delete + batched
  insert of 500). A mid college (~1–2M attendance rows, ~200k marks) is
  minutes of streaming work, off the request path; memory is bounded by the
  accumulator maps (per-node, not per-record). Verified with a 12k-row
  attendance + 6k-row marks paging test.
- **Serving is cheap:** a rollup query reads a handful of indexed rows for
  the node and runs pure in-memory closure/cohort checks — sub-millisecond
  after the DB read. The dashboard fans out one query per grant-derived
  tile (bounded by the caller's grants — a teacher has one or two).
- **Live per-student view** pulls that student's records (indexed by
  student_id), filters per record in memory, and folds — tens of ms.
- **Staleness:** rollups are ≤24h old; the live view is always current.
  Trigger a rebuild (admin recompute route) after a bulk change if a fresh
  rollup is needed sooner.
- **Frontend:** static shells (prerendered), data fetched client-side; SVG
  charts are hand-rolled (no chart-lib bundle); fonts self-hosted (no
  runtime CDN).

## Attendance & marks at class + college scale (#4)

- **Recording a section's attendance** (≤~100 entries): one directory path
  lookup, one roster read, one transaction (session + entries) — tens of
  ms. A college of 100 sections marking daily ≈ 100 such requests spread
  over the morning: noise.
- **Marksheet entry** (≤500 entries, all-or-nothing): one assessment read,
  one scope check for the whole batch (all rows share the ref), N
  studentPosition lookups (indexed; the class-size N keeps this in tens of
  ms), one upsert transaction with per-entry diffs. Corrections are single
  rows.
- **Reads:** sessions and marks carry their own org paths, so scope checks
  are pure in-memory per row — row-filtering a student's year of history
  (≤ a few hundred rows) costs microseconds after one indexed query.
- **Gap scan:** one distinct-enrollment query, one indexed session scan
  per 1k sections, daily. A 200-section college: two queries.
- **Year-scale growth:** attendance ≈ sections × working days × roster
  (~1–2M rows/year for a mid college) — the (section_id, held_on) and
  (student_id) indexes keep every access path narrow; partition by
  academic year if a deployment crosses ~10M rows (recorded trigger, not
  built).

## Bulk import at college scale (#3)

Measured shape, 5,000-row student CSV: one S3 GET, one in-memory parse
(csv-parse sync, ~MBs), ONE org-tree read building the section-lookup map,
ONE batched existence query per 1,000 admission numbers, then ~1–2 inserts
per row (student + optional enrollment). At ~1–2ms/insert that is well
under a minute end-to-end, off the request path (worker), with the request
itself returning 202 in milliseconds. Memory is bounded by the 1 MB body
cap (~10k rows); raising the cap should switch parsing to the streaming
csv-parse API — recorded as the trigger, not built. Per-row inserts (not
multi-row VALUES) were chosen for per-row error attribution; if import
throughput ever matters, batch the clean rows and keep per-row only for
retries.

## Derivation & scope costs (#3)

- Assignment writes add one identity round-trip (grant upsert + session
  invalidation) — admin-frequency operations, negligible.
- Request-path scope checks stay pure/in-memory; the people handlers add
  at most 2–3 indexed lookups to resolve a record's org position.
- Reconciliation is O(assignments) with one identity list call — hourly,
  thousands of rows at most, trivially cheap.
- The tree endpoint runs one query per department+class (N+1 by design for
  code clarity); a college with ~20 departments is ~100 fast indexed
  queries. Join-optimize when a UI polls it.

## Identity hot paths (#2)

- **Authenticated request:** one Redis round-trip (session resolve; idle
  slide is part of it). Zero Postgres reads — roles/grants ride in the
  session snapshot. The scope-check is a pure in-memory function.
- **Login:** the argon2 verify (human core) dominates by design —
  budget ~50–150ms/login depending on chosen parameters; it is the
  brute-force control. Login QPS is inherently low (a college's morning
  peak, not a feed); if it ever matters, scale web replicas — hashing is
  CPU-bound and stateless. Throttle adds two Redis ops per failure, one
  GET per attempt.
- **Session invalidation on authority change** is O(sessions-of-user) in
  Redis — trivial.
- **Admin list endpoints** hydrate roles+grants per user (N+1 against
  Postgres, capped at 200/page): fine for admin tooling; join-optimize
  only if it appears in a hot path.



## Pool sizing

- `DATABASE_POOL_MAX` default 10 **per replica**. Postgres default
  `max_connections=100`: budget = replicas × pool + workers × pool +
  migrator (2) + operator headroom. Suggested starting point on one DB
  host: 3 web × 10 + 2 worker × 10 + slack ≈ 55 — comfortable. Raise
  replicas before pool size; queue depth at the pool is preferable to
  connection thrash. When replica count grows past ~6, put pgbouncer
  (transaction mode) in front and shrink per-replica pools.
- Pool hygiene: 5s connect timeout, 30s idle reap, `application_name`
  per process for `pg_stat_activity` attribution.
- Redis: each process holds one app connection; each BullMQ component
  (queue/worker/events) owns its own, as BullMQ requires — ~4–5
  connections per worker replica, 2 per web replica. Trivial for Redis.

## Replica model

- Web and worker are independently horizontally scalable; both stateless
  (Constitution 9–10). No sticky sessions ever (sessions go to Redis
  in #2). BullMQ coordinates job ownership; `upsertJobScheduler` is
  idempotent, so N workers produce one schedule.
- Worker concurrency defaults to 5 per module queue per replica — tune per
  job class when real jobs arrive.
- Prometheus scrapes every replica; aggregation is a scrape-side concern
  (no cross-replica state in-process).

## Measured baseline

Not benchmarked yet (no business endpoints). The pipeline adds: one
authenticator call, zod parse, one histogram observe, one log line —
microseconds against any real handler; the audit insert adds one
single-row INSERT to state-changing routes only.

## First bottlenecks to expect (in order)

1. **Audit insert on the hot write path** — single-row synchronous INSERT
   per state change. Mitigations when it shows: batch-friendly table
   (already index-light), partitioning by month, or a write-behind queue
   with durability guarantees (requires a Constitution discussion since
   fail-closed semantics would weaken).
2. **Postgres connection ceiling** as replicas multiply → pgbouncer.
3. **Next.js route-handler overhead** vs. raw Node for very hot endpoints
   — measure before acting; extraction path (ADR-0001) is the escape
   hatch, not micro-tuning.
4. **Readiness pings under aggressive probe intervals** — cheap `select
   1`/`PING`, already timeout-bounded; lengthen probe interval before
   caching readiness.
5. **tsx startup cost in the worker** (~hundreds of ms once, at boot) —
   irrelevant at runtime; a compile step is recorded debt if cold-start
   frequency ever matters.

## Reporting (#6)

Report generation is a **queued worker job** (202 + poll), off the request
path — a large export never blocks an HTTP handler. Each report's cost is
bounded by the requester's scope (it reads only what they can see, through the
same read model the dashboard uses). `canProduce` — the access decision run at
both request and download — is a cheap read-model call that does no rendering,
so an out-of-scope request is rejected without generating anything. PDF is
rendered in-memory with pdfkit and streamed to a Buffer (no filesystem, no
Chromium); CSV is a string builder. Failures are captured on the `rpt_reports`
row, not retried into a storm.

Watch items when reporting sees real load: (a) very large sections/classes
produce large artifacts — object storage handles the size, but consider
paginated or summarized report kinds before whole-college exports; (b) no
retention sweep yet, so `rpt_reports` + objects grow (recorded debt — add a
TTL job); (c) report requests share the platform-wide global rate-limit note.

## Deliberate non-optimizations

No caching layer, no read replicas, no CDN concerns — none has a workload
yet. Add on evidence, not anticipation.
