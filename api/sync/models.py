"""Server copies of the synced tables (specs/plan.md, "Data model").

Field names match `web/src/db/types.ts` so sync payloads map onto rows as-is, and
`db_table` matches the sync table names. References to seed-backed rows (spread
templates, crystals, intention tags, cards) are plain values, never foreign keys:
unedited seed rows never sync, so the referenced row may not exist here.
"""

import datetime as dt
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, ClassVar, NoReturn

from django.contrib.postgres.fields import ArrayField
from django.db import connection, models, transaction
from django.utils import timezone

SERVER_VERSION_SEQUENCE = "server_version_seq"
# Rows the server writes itself carry the nil UUID as their device.
SERVER_DEVICE_ID = uuid.UUID(int=0)
# pg_advisory_xact_lock key ("Arcn") held by every transaction that writes a synced table.
SYNC_LOCK_KEY = 0x4172636E


def to_ms(value: dt.datetime) -> dt.datetime:
    """Millisecond precision, like the client's JS dates, so equal timestamps compare equal."""
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def now_ms() -> dt.datetime:
    """The server's clock for every timestamp it generates."""
    return to_ms(timezone.now())


@contextmanager
def synced_write() -> Iterator[None]:
    """Transaction holding the sync lock. Every write to a synced table runs inside one.

    Writers take `server_version` values from a sequence; without the lock, a transaction
    that took a lower value could commit after a pull has already read a higher one, and
    that pull's cursor would skip the row forever. The lock is held until commit, and pulls
    take it too, so they only ever see a gap-free prefix. Re-entrant within a transaction.
    """
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SYNC_LOCK_KEY])
        yield


def next_server_version() -> int:
    """Next value of the global sequence shared by every synced table (the pull cursor).

    Call it inside `synced_write()`; `SyncedModel.save()` does.
    """
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval(%s)", [SERVER_VERSION_SEQUENCE])
        row = cursor.fetchone()
    if row is None:  # nextval always returns a row; this only narrows the type.
        raise RuntimeError(f"nextval({SERVER_VERSION_SEQUENCE}) returned no row")
    return int(row[0])


HARD_DELETE_REFUSED = "Synced rows are never hard-deleted: devices only learn of tombstones."


class SyncedQuerySet(models.QuerySet[Any]):
    """Bulk writes skip `save()`, so they would skip the lock and the `server_version` bump.

    Hard deletes are refused too: a deleted row never reaches a pull, so devices would keep
    it forever. Deletes are tombstones (`deleted_at`), written through `save()`.
    """

    def _refuse(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("Synced rows are written one by one through save() (synced_write).")

    def delete(self) -> NoReturn:
        raise TypeError(HARD_DELETE_REFUSED)

    update = _refuse
    bulk_update = _refuse
    bulk_create = _refuse


class SyncedModel(models.Model):
    """Columns shared by every synced table. The client always supplies `id`."""

    id = models.UUIDField(primary_key=True)
    updated_at = models.DateTimeField(help_text="Client clock; last-write-wins compares it.")
    deleted_at = models.DateTimeField(null=True, blank=True, help_text="Tombstone.")
    server_version = models.BigIntegerField(unique=True, editable=False)
    device_id = models.UUIDField(help_text="Device that last wrote the row.")

    objects = SyncedQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args: Any, **kwargs: Any) -> None:
        # Every write takes a fresh value, so the cursor sees inserts and updates alike.
        with synced_write():
            self.server_version = next_server_version()
            super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError(HARD_DELETE_REFUSED)

    def tombstone(self) -> None:
        """Delete the server's way: a tombstone stamped with the server's clock and device."""
        self.deleted_at = self.updated_at = now_ms()
        self.device_id = SERVER_DEVICE_ID
        self.save()


class Currency(models.TextChoices):
    CRC = "CRC"
    USD = "USD"


class SessionType(models.TextChoices):
    IN_PERSON = "in_person"
    ONLINE = "online"
    MESSAGE = "message"


class PaymentMethod(models.TextChoices):
    SINPE = "sinpe"
    CASH = "cash"
    TRANSFER = "transfer"
    PAYPAL = "paypal"
    OTHER = "other"


class Client(SyncedModel):
    name = models.TextField()
    instagram = models.TextField(null=True, blank=True)
    whatsapp = models.TextField(null=True, blank=True)
    email = models.TextField(null=True, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    birth_time = models.TimeField(null=True, blank=True)
    birth_place_label = models.TextField(null=True, blank=True)
    birth_lat = models.FloatField(null=True, blank=True)
    birth_lng = models.FloatField(null=True, blank=True)
    birth_tz = models.TextField(null=True, blank=True, help_text="IANA timezone.")
    notes = models.TextField(blank=True)
    tags = ArrayField(models.TextField(), default=list, blank=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField()

    class Meta:
        db_table = "client"

    def __str__(self) -> str:
        return self.name


class Session(SyncedModel):
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="sessions")
    started_at = models.DateTimeField()
    type = models.TextField(choices=SessionType.choices)
    price_minor = models.BigIntegerField(
        null=True, blank=True, help_text="Integer minor units (céntimos/cents)."
    )
    currency = models.TextField(choices=Currency.choices, default=Currency.CRC)
    notes = models.TextField(blank=True)
    follow_up_note = models.TextField(blank=True)
    follow_up_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "session"

    def __str__(self) -> str:
        return f"{self.client_id} @ {self.started_at:%Y-%m-%d}"


class Payment(SyncedModel):
    session = models.ForeignKey(Session, on_delete=models.PROTECT, related_name="payments")
    # Denormalized from the session for fast per-client totals.
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="payments")
    amount_minor = models.BigIntegerField(help_text="Integer minor units (céntimos/cents).")
    currency = models.TextField(choices=Currency.choices)
    method = models.TextField(choices=PaymentMethod.choices)
    paid_at = models.DateField()
    reference = models.TextField(null=True, blank=True)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "payment"

    def __str__(self) -> str:
        return f"{self.amount_minor} {self.currency} on {self.paid_at}"


class Reading(SyncedModel):
    session = models.ForeignKey(Session, on_delete=models.PROTECT, related_name="readings")
    # Reference only: seed templates never sync unless edited, so no foreign key.
    spread_template_id = models.UUIDField()
    spread_snapshot = models.JSONField()
    label = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        db_table = "reading"

    def __str__(self) -> str:
        return self.label or str(self.spread_snapshot.get("name", self.id))


class CardDraw(SyncedModel):
    reading = models.ForeignKey(Reading, on_delete=models.PROTECT, related_name="card_draws")
    position_index = models.PositiveSmallIntegerField(help_text="1-based.")
    card_id = models.TextField(help_text="Seed card key, e.g. major-00.")
    reversed = models.BooleanField(default=False)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "card_draw"
        constraints: ClassVar = [
            models.CheckConstraint(
                condition=models.Q(position_index__gte=1), name="card_draw_position_index_gte_1"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.position_index}: {self.card_id}"


class SpreadTemplate(SyncedModel):
    name = models.TextField()
    description = models.TextField(blank=True)
    positions = models.JSONField()
    is_seed = models.BooleanField(default=False)
    seed_key = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "spread_template"

    def __str__(self) -> str:
        return self.name


class Crystal(SyncedModel):
    seed_key = models.TextField(null=True, blank=True)
    name = models.TextField()
    colors = ArrayField(models.TextField(), default=list, blank=True)
    chakras = ArrayField(models.TextField(), default=list, blank=True)
    signs = ArrayField(models.TextField(), default=list, blank=True)
    intentions = ArrayField(
        models.TextField(), default=list, blank=True, help_text="Intention tag keys."
    )
    description = models.TextField(blank=True)
    care = models.TextField(blank=True)
    hidden = models.BooleanField(default=False)
    user_modified = models.BooleanField(default=False)

    class Meta:
        db_table = "crystal"

    def __str__(self) -> str:
        return self.name


class IntentionTag(SyncedModel):
    # Not unique: two devices may create the same key offline; sync resolves it.
    key = models.TextField()
    label = models.TextField(
        null=True, blank=True, help_text="Null for an unrenamed seed tag (UI uses es.json)."
    )

    class Meta:
        db_table = "intention_tag"

    def __str__(self) -> str:
        return self.label or self.key


class CardNote(SyncedModel):
    card_id = models.TextField(help_text="Seed card key, e.g. major-00.")
    note = models.TextField(blank=True)

    class Meta:
        db_table = "card_note"

    def __str__(self) -> str:
        return self.card_id


SYNCED_TABLE_NAMES = (
    "client",
    "session",
    "payment",
    "reading",
    "card_draw",
    "spread_template",
    "crystal",
    "intention_tag",
    "card_note",
    "conflict",
    "horoscope",
)


class Conflict(SyncedModel):
    table = models.TextField(choices=[(name, name) for name in SYNCED_TABLE_NAMES])
    # Any table's row, so no foreign key.
    record_id = models.UUIDField()
    field = models.TextField()
    losing_value = models.TextField(null=True, blank=True)
    losing_device_id = models.UUIDField()
    created_at = models.DateTimeField()
    resolved = models.BooleanField(default=False)

    class Meta:
        db_table = "conflict"

    def __str__(self) -> str:
        return f"{self.table}.{self.field} ({self.record_id})"
