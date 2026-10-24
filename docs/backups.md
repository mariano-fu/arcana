# Backups and restores

The server's database is backed up with `pg_dump` (T4.3; design in `specs/plan.md`, "Deploy").
This is the server's copy only: her devices keep their own data, and Ajustes → Respaldo exports
a JSON backup that works with no server at all (constitution §2).

## What runs

| When | What | Reason in the file name |
| --- | --- | --- |
| Every night, 03:00 Costa Rica time (`deploy/crontab`) | `manage.py backup_db` in `cron` | `nightly` |
| Every `docker compose up`, if migrations are pending | `manage.py migrate_with_backup` in `migrate`, before migrating | `pre-migrate` |
| Every restore, before replacing the data | `manage.py restore_db` | `pre-restore` |

Files are `pg_dump` custom-format dumps in `BACKUP_DIR`, named
`arcana-<UTC timestamp>-<reason>.dump`, e.g. `arcana-20261024T090000Z-nightly.dump` (03:00 in
Costa Rica is 09:00 UTC). Each dump is written as `.partial`, checked with `pg_restore --list`,
then renamed, so a file with the final name is always readable.

**Retention:** after every backup, dumps older than 30 days (`BACKUP_RETENTION_DAYS`) are
deleted, all reasons alike, but the newest 7 (`BACKUP_KEEP_MIN`) are always kept, however old:
if backups stop working, pruning never deletes the last good ones. Only files named as above are
ever deleted; anything else in the directory is left alone.

If the pre-migrate dump fails, nothing is migrated: `migrate` exits with an error, `api` and
`cron` don't start, and Caddy keeps serving the app shell (`/api` answers 502). Fix the backup
directory, then `docker compose up -d` again.

## Setup (once)

`BACKUP_DIR` in `deploy/.env` is a directory on the homelab's **second disk**, not the one
holding the Docker volumes. It is required: compose refuses to start without it. The containers
run as uid 10001, which must own it:

```sh
sudo mkdir -p <second-disk>/arcana-backups
sudo chown 10001:10001 <second-disk>/arcana-backups
sudo chmod 0700 <second-disk>/arcana-backups      # client data: nobody else reads it
echo 'BACKUP_DIR=<second-disk>/arcana-backups' >> deploy/.env
```

Check it once the stack is up:

```sh
docker compose exec cron python manage.py backup_db --reason nightly
ls -l <second-disk>/arcana-backups
```

## Checking that backups run

There is no alerting (v1). Look now and then, and before any upgrade:

```sh
ls -lt <second-disk>/arcana-backups | head                # a nightly dump from last night?
docker compose logs --since 48h cron | grep -i backup     # "Backup written" or "Backup failed"
```

## Restoring

```sh
cd deploy
ls <second-disk>/arcana-backups                           # pick a file
./restore.sh arcana-20261024T090000Z-nightly.dump         # asks you to type the name again
```

`restore.sh`:

1. stops `api`, `cron` and `admin` (nothing writes during the restore; devices get a 502 on
   sync and retry later),
2. runs `manage.py restore_db` in the `migrate` service, which
   - checks that the dump is readable,
   - dumps the current database (`pre-restore`), so a restore can be undone by restoring that,
   - replaces the `public` schema with the dump's in **one transaction** (if any statement
     fails, nothing changes),
   - migrates, so an older backup catches up with the deployed code,
   - runs `rotate_sync_epoch`: the restored database gets a new sync epoch,
3. starts the stack again.

Devices then see the new epoch on their next sync, re-push every row they have and pull from 0.
Last-write-wins keeps the newest copy of each row, so edits made on a device after the backup
come back from that device. Rows that exist only on the server and were written after the
backup are gone.

If `restore.sh` fails, it leaves `api` and `cron` stopped. A failure before or during the
restore transaction changed nothing: `docker compose up -d` starts the old data again. Read the
error first; if the restore went through but `migrate` failed, the database holds the backup and
is not yet migrated, so don't start the api until that's fixed.

## Restore drill

Never on the real stack. `deploy/smoke.sh` rehearses the whole procedure on a throwaway one (its
`backups` section: nightly dump, pre-migrate dump, `restore.sh`, epoch rotation) under its own
project name, volume and temporary backup directory; CI's `deploy` job runs it on every PR.
It restores a dump it made itself, not one of the real backups.

To run it on the homelab, keep its default names, or pick new ones with `SMOKE_PROJECT` and
`SMOKE_PGDATA_VOLUME`; never `arcana` or `arcana_pgdata`. It refuses (exit 2) those names and any
volume that already exists, because its cleanup removes the project's containers and that
volume.

Every few months, also check that a real dump is readable, without restoring it anywhere:

```sh
docker compose exec cron pg_restore --list /backups/<latest nightly dump> | head
```

## Known limits

- No off-site copy and no encryption: dumps stay on the homelab's second disk, readable by
  uid 10001 and root. A fire or theft of the homelab loses both copies. Her devices and JSON
  exports remain the other copies.
- No alerting when a nightly backup fails; see "Checking that backups run".
- A dump killed halfway leaves a `.partial` file, which is never pruned; delete it by hand.
- The Postgres client in the `cron` image is version 16, like the server. Upgrading the server
  to a new major version means bumping `PG_MAJOR` in `api/Dockerfile` in the same change.
