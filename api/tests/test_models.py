import uuid

import pytest
from django.db import IntegrityError, transaction

from horoscopes.models import SERVER_DEVICE_ID
from sync.models import SYNCED_TABLE_NAMES, CardDraw, Reading
from sync.registry import synced_models
from tests import factories

pytestmark = pytest.mark.django_db


def test_server_version_is_global_and_increases_on_every_write() -> None:
    client = factories.ClientFactory()
    crystal = factories.CrystalFactory()
    horoscope = factories.HoroscopeFactory()
    first_client_version = client.server_version

    client.notes = "edited"
    client.save()

    versions = [first_client_version, crystal.server_version, horoscope.server_version]
    assert versions == sorted(versions)
    assert len(set(versions)) == 3
    assert client.server_version > horoscope.server_version


def test_server_version_is_not_taken_from_the_caller() -> None:
    client = factories.ClientFactory.build()
    client.server_version = 1
    client.save()

    other = factories.ClientFactory()
    assert other.server_version > client.server_version


def test_registry_covers_every_sync_table() -> None:
    registry = synced_models()

    assert set(registry) == set(SYNCED_TABLE_NAMES)
    assert registry["card_draw"] is CardDraw


def test_reading_may_reference_a_spread_template_the_server_never_saw() -> None:
    # Unedited seed spreads never sync (plan.md, "Seed vs. user edits").
    unknown_template = uuid.uuid4()

    reading = factories.ReadingFactory(spread_template_id=unknown_template)

    reading.refresh_from_db()
    assert reading.spread_template_id == unknown_template


def test_crystal_intentions_are_tag_keys_not_references() -> None:
    crystal = factories.CrystalFactory(intentions=["calm", "not-a-synced-tag"])

    crystal.refresh_from_db()
    assert crystal.intentions == ["calm", "not-a-synced-tag"]


def test_money_columns_hold_large_integer_minor_units() -> None:
    payment = factories.PaymentFactory(amount_minor=10**15)

    payment.refresh_from_db()
    assert payment.amount_minor == 10**15


def test_card_draw_position_index_is_one_based() -> None:
    with pytest.raises(IntegrityError):
        factories.CardDrawFactory(position_index=0)


def test_horoscope_defaults_mark_server_written_rows() -> None:
    horoscope = factories.HoroscopeFactory()

    assert horoscope.device_id == SERVER_DEVICE_ID
    assert horoscope.period == "day"
    assert horoscope.text_es is None


def test_horoscope_is_unique_per_date_sign_and_period() -> None:
    first = factories.HoroscopeFactory()

    with pytest.raises(IntegrityError):
        factories.HoroscopeFactory(date=first.date, sign=first.sign)


@pytest.mark.django_db(transaction=True)
def test_child_rows_may_arrive_before_their_parent_in_one_transaction() -> None:
    # A sync push isn't ordered by dependency; foreign keys are checked at commit.
    session = factories.SessionFactory()
    reading = factories.ReadingFactory.build(session=session)

    with transaction.atomic():
        factories.CardDrawFactory(reading=reading)
        reading.save()

    assert CardDraw.objects.get().reading_id == reading.id


@pytest.mark.django_db(transaction=True)
def test_missing_parent_fails_at_commit() -> None:
    orphan = factories.ReadingFactory.build(session=factories.SessionFactory())

    with pytest.raises(IntegrityError), transaction.atomic():
        factories.CardDrawFactory(reading=orphan)

    assert not Reading.objects.exists()
    assert not CardDraw.objects.exists()
