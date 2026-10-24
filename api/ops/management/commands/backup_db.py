from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from ops.backups import REASONS, BackupError, create_backup


class Command(BaseCommand):
    help = (
        "Dump the database to BACKUP_DIR (pg_dump custom format), check the dump, then delete "
        "dumps older than BACKUP_RETENTION_DAYS, always keeping the newest BACKUP_KEEP_MIN."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--reason", choices=REASONS, default="nightly")

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            path = create_backup(options["reason"])
        except BackupError as error:
            raise CommandError(f"Backup failed: {error}") from error
        self.stdout.write(f"Backup written: {path}")
