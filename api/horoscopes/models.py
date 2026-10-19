import uuid
from typing import ClassVar

from django.db import models
from django.utils import timezone

from sync.models import SyncedModel

# Rows the server writes itself carry the nil UUID as their device.
SERVER_DEVICE_ID = uuid.UUID(int=0)


class Horoscope(SyncedModel):
    """Server-owned; clients only receive these through sync."""

    class Period(models.TextChoices):
        DAY = "day"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    updated_at = models.DateTimeField(default=timezone.now)
    device_id = models.UUIDField(default=SERVER_DEVICE_ID)
    date = models.DateField()
    sign = models.TextField(help_text="Zodiac seed key, e.g. scorpio.")
    period = models.TextField(choices=Period.choices, default=Period.DAY)
    text_en = models.TextField()
    text_es = models.TextField(null=True, blank=True, help_text="Null when not translated.")
    source = models.TextField()
    translator = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "horoscope"
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["date", "sign", "period"], name="horoscope_unique_date_sign_period"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.sign}"
