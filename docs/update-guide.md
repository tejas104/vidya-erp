# Update guide — Vidya (on-premise, single institution)

`update.sh` applies a release tarball to an existing install (one created by
`install.sh`). It is **not** the installer — see
[`docs/install-guide.md`](install-guide.md) for a fresh install, and
[`docs/runbook-backup-restore.md`](runbook-backup-restore.md) for the backup
mechanics this script builds on.

```bash
bash update.sh path/to/vidya-release-X.Y.Z.tar.gz
```

No signature/crypto logic lives in `update.sh` either — the license/edition
gate (step 3) runs `scripts/license-issue.ts --verify` inside a throwaway
container from the currently-installed `worker` image, exactly like
`install.sh` does. `update.sh` also never builds images: the new release's
images are obtained (`docker load` for an offline release, `docker compose
pull` for a registry one) in step 6, before anything is applied.

## What "refuses to run" means here — read this before assuming you're locked out

`update.sh` can refuse to proceed on an **edition mismatch** or a license
**expired beyond the 30-day grace window**. This is **not** the product
locking an institution out of anything. Per deliberate policy (Decision 1,
[`docs/superpowers/specs/2026-08-13-license-verification-design.md`](superpowers/specs/2026-08-13-license-verification-design.md)):
an expired license never blocks the app — every feature keeps working,
indefinitely, expired or not. What `update.sh` refuses in that state is
specifically the **vendor-performed update step**, which is an AMC
(Annual Maintenance Contract) service. The running app is completely
unaffected by this refusal; it keeps serving exactly as before. Renew the
license/AMC and re-run.

An **absent** license (none configured) does **not** block updates — only a
confirmed edition mismatch or a confirmed expiry past grace does.

## Step-by-step

### 1/7 Preflight

Checks Docker, Compose v2, `rsync`, and that `.env` already exists (i.e.
this is a real existing install — `update.sh` refuses to run against a bare
host; use `install.sh` there instead).

### 2/7 Unpack release

Extracts the tarball to a temp directory (cleaned up automatically on exit,
success or failure), unwraps a single wrapping top-level directory if
present, and sanity-checks it looks like a Vidya release (`package.json` +
`docker-compose.yml` at its root). Reads the current and new version from
each tree's `package.json`.

```
[ OK ] unpacked: 0.4.1 -> 0.5.0
```

### 3/7 License / edition gate

See "What refuses to run means" above. Runs inside the **currently
installed** `worker` image — nothing from the new release is touched yet,
so this check can never be broken by a bad release artifact. An
unparseable/malformed license **fails open** (the update proceeds, with a
warning) — this gate only ever blocks on a *confirmed* edition mismatch or
expiry, never on ambiguity, because a security patch must never be
un-shippable due to a license-file parsing hiccup.

### 4/7 Confirm

```
Update 0.4.1 -> 0.5.0? A backup will be taken first, then the new images
will be obtained and the stack restarted. [y/N]
```

Nothing has changed on disk or in any container up to this point — answering
anything but `y` exits cleanly.

### 5/7 Backup

Runs `scripts/backup.sh` and **verifies a new `.dump` file actually
appeared** in `backups/db/daily/` before proceeding — a backup command that
exits `0` but silently produces nothing is treated as a failure, not a pass.
**If this step fails for any reason, `update.sh` aborts immediately, before
touching any release file, image, or container.**

### 6/7 Apply, migrate, restart

In order:

1. Tags the current `web`/`worker` images with a `-rollback` suffix (asking
   `docker compose config --images` for the exact name Compose resolves each
   service to, rather than assuming a naming convention) — the safety net for
   step 6's health check.
2. **Obtains the new release's images — never builds them.** An offline
   release carries `images/*.tar.gz` in the unpacked tree (`docker load`,
   then retag onto the names Compose expects); otherwise `docker compose
   pull` (registry release). If neither produces a usable `web`, `worker`,
   and `migrate` image, `update.sh` aborts here, before touching `.env`, the
   release files on disk, or any running container.
3. `rsync`s the new release tree over the live install, **excluding `.env`,
   `backups/`, `certs/`, `.git/`** — your secrets, your backup history, your
   TLS material, and your license file (which isn't part of any release
   tarball to begin with, so it's untouched regardless) all survive.
4. Runs the `migrate` service on the new image, checks its exit code
   explicitly. **If migration fails, `web`/`worker` are never touched** —
   the app keeps running the old version. Release files on disk are now the
   new version though (a "stopped mid-update" state); fix the migration
   issue and re-run `update.sh` — it reapplies the same files and retries
   cleanly.
5. Force-recreates `web`/`worker` on the new images.
6. Polls `/api/v1/system/ready` (same mechanism as `install.sh`) for up to
   60 seconds.

**On a failed health check, `update.sh` automatically rolls back**: retags
the `-rollback` images back onto the names Compose actually uses for
`web`/`worker` and force-recreates them, then prints:

```
ROLLED BACK: web/worker are back on the 0.4.1 images.

IMPORTANT — what this rollback did and did NOT do:
  - It restored the PREVIOUS APPLICATION IMAGES only.
  - It did NOT undo the migration that ran in step 6. ...
  - If so, the only clean fix is a full data restore from the pre-update
    backup taken in step 5 above: see docs/runbook-backup-restore.md ...
  - Release files on disk are still the NEW ones (only the running images
    were rolled back) — re-running update.sh from the same tarball is safe
    once the underlying problem is fixed.
```

**What rollback restores, precisely:**

| | Restored by automatic rollback? |
|---|---|
| `web`/`worker` container images | **Yes** — retagged and force-recreated |
| Running application code/behavior | **Yes**, as a consequence of the above |
| Database schema (migrations already applied) | **No** — migrations are forward-only here; rollback does not run `scripts/migrate.ts down` |
| Database data | **No** — only a full restore from the step 5 backup does this (`docs/runbook-backup-restore.md`) |
| `.env`, secrets, license file | **N/A — never touched** by either the update or the rollback |

If the failure is a simple app-level bug and the migration was backward
compatible, the automatic rollback alone is sufficient. If the migration
changed the schema in a way the old code can't tolerate, a full data restore
per the runbook is the only clean path — the rollback message says this
explicitly rather than implying the app is fully back to normal.

### 7/7 Done

```
  0.4.1 -> 0.5.0  (git a1b2c3d)

Rollback image tags (...:rollback) were left in place as a safety net until
the next update.
```

## Troubleshooting

Shares its root causes with installation — see the [full table in
`docs/install-guide.md`](install-guide.md#troubleshooting), in particular
#1 (`Cannot find package 'prom-client'` in the rebuilt images) and #7
(never source `.env` before a manual build). Update-specific ones:

| Symptom | Cause | Fix |
|---|---|---|
| `refusing to perform this update: the license expired N day(s) ago` | AMC/license lapsed beyond the 30-day grace window | This blocks *only* `update.sh`, not the running app (see above) — renew, then re-run |
| `refusing to perform this update: the on-file license does not match this install's edition` | `.env`'s `VIDYA_EDITION` and the license at `VIDYA_LICENSE_PATH` disagree | Fix whichever one is wrong — most likely the license file was swapped for the wrong institution's |
| Update aborts at "migrations failed" | New release's migration hit a real error against this install's data (not a rollback trigger — nothing user-facing changed) | `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs migrate`; fix and re-run `update.sh` with the same tarball |
| Health check fails, automatic rollback runs | New release's `web`/`worker` crash-loop or fail readiness — check `docker compose ... logs web` after rollback restores service | Read the rollback message's data-safety notes before assuming a plain retry is safe if a migration ran |
