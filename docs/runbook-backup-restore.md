# Runbook — Backup & Restore (Vidya)

Covers the two stateful stores in the compose stack: **PostgreSQL** (the system
of record) and the **MinIO bucket** (report PDFs/CSVs, import CSVs, coursework
materials). Redis holds only sessions and queues — it is deliberately not
backed up (a restart re-authenticates users and re-derives schedules).

Scripts: [`scripts/backup.sh`](../scripts/backup.sh),
[`scripts/restore.sh`](../scripts/restore.sh),
[`scripts/restore-drill.sh`](../scripts/restore-drill.sh). All run from the
repo root on the Docker host and drive the containers via `docker compose exec`
(no published DB port required — works with the hardened prod overlay).

## What gets backed up

| Store | Method | Artifact | Retention |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` (compressed custom format) | `backups/db/daily/vidya-<stamp>.dump` | **7 daily**, **4 weekly** (Sun) |
| MinIO bucket | `mc mirror` (incremental snapshot) | `backups/minio/vidya/…` | current mirror (see note) |

**Why the bucket is a mirror, not point-in-time:** object keys are random
UUIDs written once and never mutated, and every artifact is re-derivable
(re-run the report/import). The Postgres dump is the crown jewel and is the one
kept as dated, pruned generations. If you need point-in-time object history,
turn on MinIO versioning on the bucket and snapshot the `minio-data` volume
instead — recorded as an upgrade path, not built here.

## Nightly backup

Run manually:

```bash
bash scripts/backup.sh
```

Schedule (Docker host crontab — 02:30 nightly, log to a file):

```cron
30 2 * * *  cd /opt/vidya && /usr/bin/env bash scripts/backup.sh >> /var/log/vidya-backup.log 2>&1
```

Alternatively as a **compose sidecar** (add to `docker-compose.prod.yml` if you
prefer no host cron). This mounts the socket so it can `docker compose exec`:

```yaml
  backup:
    image: docker:cli
    restart: unless-stopped
    entrypoint: ["sh","-c","while true; do sleep 86400; bash /repo/scripts/backup.sh; done"]
    working_dir: /repo
    volumes:
      - .:/repo
      - /var/run/docker.sock:/var/run/docker.sock
```

(Host cron is simpler and easier to alert on; pick one.)

Environment overrides (all optional, defaults match the compose stack):
`BACKUP_ROOT`, `POSTGRES_DB`, `POSTGRES_USER`, `S3_BUCKET`, `MINIO_ROOT_USER`,
`MINIO_ROOT_PASSWORD`, `DAILY_KEEP` (7), `WEEKLY_KEEP` (4), `COMPOSE_NET`.

### Verifying the cron ran

```bash
ls -lt backups/db/daily | head        # newest dump < 24h old?
tail /var/log/vidya-backup.log        # ends with "[backup] done. daily=N weekly=M"
```

Alert if the newest dump is older than 25h.

## Restore procedure (real incident)

> **Restoring drops and recreates the `vidya` database.** Stop the app first so
> nothing writes mid-restore.

1. **Stop web + worker** (leave Postgres/Redis/MinIO running):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml stop web worker
   ```
2. **Choose the dump.** Newest daily is the default; list them to pick another:
   ```bash
   ls -lt backups/db/daily backups/db/weekly
   ```
3. **Restore the database** (default = newest daily, or pass a path):
   ```bash
   bash scripts/restore.sh                                   # newest daily
   bash scripts/restore.sh backups/db/weekly/vidya-XXXX.dump  # a specific one
   ```
   The script terminates stray connections, drops+recreates the DB, and
   `pg_restore`s. Data loads before the append-only audit triggers are created,
   so the audit trail restores intact.
4. **Restore objects** (only if the bucket was also lost — pushes the mirror
   back up):
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm --network atlas_default \
     -e "MC_HOST_minio=http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@minio:9000" \
     -v "$PWD/backups/minio/vidya:/backup" \
     minio/mc mirror --overwrite /backup minio/vidya
   ```
5. **Bring the app back and check:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml start web worker
   pnpm db:status          # journal matches disk
   curl -k https://localhost/ready
   ```

## Restore DRILL (proves the backups are real)

Run against a stack that has data (seed first if empty). The drill snapshots
per-table row counts, backs up, **destroys** the database, restores, and
asserts every table's count matches — exit 0 only on a match.

```bash
bash scripts/restore-drill.sh
```

Verified output (seeded demo DB):

```
=== restore drill: vidya ===
[drill] live DB: 46 tables, 6661 rows total
[drill] --- backing up ---
[backup]   -> /d/ATLAS/backups/db/daily/vidya-20260721-163657.dump (392K)
[drill] --- DESTROYING database ---
[drill] after destroy: 0 rows (expected 0)
[drill] --- restoring ---
[drill] restored DB: 6661 rows total
[drill] --- comparing per-table counts ---
[drill] PASS: all 46 tables match (6661 rows).
```

Run the drill on a **staging copy** monthly and after any Postgres version bump.
On production, prefer restoring the latest dump into a throwaway database and
diffing counts rather than destroying the live one.
