"""Factories for the synced models. Fake values only, never real client data."""

import datetime as dt
import uuid

import factory
from django.utils import timezone

from horoscopes.models import Horoscope
from sync import models

DEVICE_A = uuid.UUID("0190a000-0000-7000-8000-00000000000a")


class SyncedFactory(factory.django.DjangoModelFactory):
    id = factory.LazyFunction(uuid.uuid4)
    updated_at = factory.LazyFunction(timezone.now)
    device_id = DEVICE_A

    class Meta:
        abstract = True


class ClientFactory(SyncedFactory):
    name = factory.Sequence(lambda n: f"Test Client {n}")
    created_at = factory.LazyFunction(timezone.now)

    class Meta:
        model = models.Client


class SessionFactory(SyncedFactory):
    client = factory.SubFactory(ClientFactory)
    started_at = factory.LazyFunction(timezone.now)
    type = models.SessionType.IN_PERSON
    price_minor = 2_000_000  # ₡20 000

    class Meta:
        model = models.Session


class PaymentFactory(SyncedFactory):
    session = factory.SubFactory(SessionFactory)
    client = factory.SelfAttribute("session.client")
    amount_minor = 2_000_000
    currency = models.Currency.CRC
    method = models.PaymentMethod.SINPE
    paid_at = factory.LazyFunction(lambda: timezone.now().date())

    class Meta:
        model = models.Payment


class ReadingFactory(SyncedFactory):
    session = factory.SubFactory(SessionFactory)
    spread_template_id = factory.LazyFunction(uuid.uuid4)
    spread_snapshot = factory.LazyFunction(
        lambda: {"name": "1 carta", "positions": [{"index": 1, "name": "Carta", "meaning": ""}]}
    )
    created_at = factory.LazyFunction(timezone.now)

    class Meta:
        model = models.Reading


class CardDrawFactory(SyncedFactory):
    reading = factory.SubFactory(ReadingFactory)
    position_index = 1
    card_id = "major-00"

    class Meta:
        model = models.CardDraw


class SpreadTemplateFactory(SyncedFactory):
    name = factory.Sequence(lambda n: f"Custom spread {n}")
    positions = factory.LazyFunction(
        lambda: [{"index": 1, "name": "Carta", "meaning": "", "layout": None}]
    )

    class Meta:
        model = models.SpreadTemplate


class CrystalFactory(SyncedFactory):
    name = factory.Sequence(lambda n: f"Crystal {n}")
    intentions = factory.LazyFunction(lambda: ["calm"])

    class Meta:
        model = models.Crystal


class IntentionTagFactory(SyncedFactory):
    key = factory.Sequence(lambda n: f"tag-{n}")

    class Meta:
        model = models.IntentionTag


class CardNoteFactory(SyncedFactory):
    card_id = "cups-07"
    note = "Test note"

    class Meta:
        model = models.CardNote


class ConflictFactory(SyncedFactory):
    table = "client"
    record_id = factory.LazyFunction(uuid.uuid4)
    field = "notes"
    losing_value = "Older note"
    losing_device_id = uuid.UUID("0190a000-0000-7000-8000-00000000000b")
    created_at = factory.LazyFunction(timezone.now)

    class Meta:
        model = models.Conflict


class HoroscopeFactory(factory.django.DjangoModelFactory):
    date = factory.Sequence(lambda n: dt.date(2026, 1, 1) + dt.timedelta(days=n))
    sign = "scorpio"
    text_en = "Test horoscope."
    source = "manual"

    class Meta:
        model = Horoscope
