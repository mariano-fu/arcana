from typing import Any

from django.core.management.base import BaseCommand

from sync.models import rotate_epoch


class Command(BaseCommand):
    help = (
        "Give the database a new sync epoch. Run it after restoring a backup: devices then "
        "re-push their rows and pull everything again, instead of trusting cursors that refer "
        "to the database as it was before the restore."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        self.stdout.write(f"New sync epoch: {rotate_epoch()}")
