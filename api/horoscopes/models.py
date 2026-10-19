import uuid
from typing import ClassVar

from django.db import models

from sync.models import SERVER_DEVICE_ID, SyncedModel, now_ms

__all__ = ["SERVER_DEVICE_ID", "Horoscope"]


class Horoscope(SyncedModel):
    """Server-owned; clients only receive these through sync."""

    class Period(models.TextChoices):
        DAY = "day"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    updated_at = models.DateTimeField(default=now_ms)
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
