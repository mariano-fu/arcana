from typing import Any

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from ops.backups import BackupError, create_backup, pending_migrations


class Command(BaseCommand):
    help = (
        "The deploy's one-shot migrate: if migrations are pending on an existing database, dump "
        "it to BACKUP_DIR first (reason pre-migrate), then migrate. If the dump fails, nothing "
        "is migrated."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        pending = pending_migrations()
        if pending is None:
            self.stdout.write("New database: nothing to back up before migrating.")
        elif pending:
            try:
                path = create_backup("pre-migrate")
            except BackupError as error:
                raise CommandError(f"Backup before migrating failed, not migrating: {error}") from (
                    error
                )
            self.stdout.write(f"Backup before migrating: {path}")
        call_command("migrate", interactive=False, stdout=self.stdout, stderr=self.stderr)
