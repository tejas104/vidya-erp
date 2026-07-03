# Performance review — Vidya #1 foundation

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

## Deliberate non-optimizations

No caching layer, no read replicas, no CDN concerns — none has a workload
yet. Add on evidence, not anticipation.
