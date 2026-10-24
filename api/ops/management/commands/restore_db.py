from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from ops.backups import BackupError, resolve_backup, restore_backup


class Command(BaseCommand):
    help = (
        "Replace the whole database with a backup (a file name in BACKUP_DIR, or a path). Dumps "
        "the current database first (reason pre-restore), restores in one transaction, migrates, "
        "then runs rotate_sync_epoch so devices re-push and pull everything again. Stop api and "
        "cron first: deploy/restore.sh does all of it."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("backup", help="File name in BACKUP_DIR, or a path.")
        parser.add_argument(
            "--yes", action="store_true", help="Confirm: the current data is replaced."
        )

    def handle(self, *args: Any, **options: Any) -> None:
        if not options["yes"]:
            raise CommandError("This replaces the whole database; pass --yes to confirm.")
        try:
            path = resolve_backup(options["backup"])
            before, after = restore_backup(path)
        except BackupError as error:
            raise CommandError(f"Restore failed: {error}") from error
        self.stdout.write(f"Restored {path.name}. Sync epoch: {before} → {after}.")
