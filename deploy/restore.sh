#!/usr/bin/env bash
# Restore a database backup (T4.3, docs/backups.md). From the homelab, in deploy/:
#
#   ./restore.sh arcana-20261024T090000Z-nightly.dump    # a file name in BACKUP_DIR
#   ./restore.sh --yes <file>                            # no prompt (smoke.sh)
#
# Stops everything that writes to the database (api, cron, admin), then `restore_db` in the
# migrate service: it dumps the current database first (pre-restore), restores in one
# transaction, migrates and runs rotate_sync_epoch, so devices re-push and pull again. Then
# the stack is started again. Caddy keeps serving the app shell; /api answers 502 meanwhile.
#
# COMPOSE_PROJECT_NAME and ENV_FILE select another stack and env file, as smoke.sh does.
set -euo pipefail

cd "$(dirname "$0")"

yes=""
if [ "${1:-}" = "--yes" ]; then
	yes=1
	shift
fi
if [ "$#" -ne 1 ]; then
	echo "usage: $0 [--yes] <backup file name in BACKUP_DIR>" >&2
	exit 2
fi
backup=$1

compose() {
	if [ -n "${ENV_FILE:-}" ]; then
		docker compose --env-file "$ENV_FILE" "$@"
	else
		docker compose "$@"
	fi
}

if [ -z "$yes" ]; then
	echo "This replaces the whole database with $backup."
	echo "The current data is dumped first (a pre-restore backup in BACKUP_DIR)."
	read -r -p "Type the file name to confirm: " typed
	if [ "$typed" != "$backup" ]; then
		echo "Not confirmed; nothing changed." >&2
		exit 1
	fi
fi

compose up -d --wait db
compose --profile admin stop api cron admin

if ! compose run --rm --no-deps migrate python manage.py restore_db --yes "$backup"; then
	echo "Restore failed. api and cron are stopped; see docs/backups.md before starting them." >&2
	exit 1
fi

compose up -d --wait
echo "Restored $backup; devices pick up the new sync epoch on their next sync."
