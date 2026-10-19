import threading
import uuid

import pytest
from django.apps import apps
from django.db import IntegrityError, connection, models, transaction

from horoscopes.models import SERVER_DEVICE_ID
from sync.models import SYNC_LOCK_KEY, SYNCED_TABLE_NAMES, CardDraw, Client, Reading
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


def other_connection_can_take_sync_lock() -> bool:
    result: list[bool] = []

    def try_lock() -> None:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_xact_lock(%s)", [SYNC_LOCK_KEY])
                result.append(cursor.fetchone()[0])
        finally:
            connection.close()

    thread = threading.Thread(target=try_lock)
    thread.start()
    thread.join()
    return result[0]


def test_synced_writes_hold_the_sync_lock_until_commit() -> None:
    # The test runs inside one open transaction, so the lock taken by save() is still held.
    assert other_connection_can_take_sync_lock()

    factories.ClientFactory()

    assert not other_connection_can_take_sync_lock()


@pytest.mark.parametrize("method", ["update", "bulk_update", "bulk_create"])
def test_bulk_writes_that_skip_save_are_refused(method: str) -> None:
    factories.ClientFactory()

    with pytest.raises(TypeError, match="save"):
        getattr(Client.objects.all(), method)()


def test_hard_deletes_are_refused() -> None:
    client = factories.ClientFactory()

    with pytest.raises(TypeError, match="tombstones"):
        client.delete()
    with pytest.raises(TypeError, match="tombstones"):
        Client.objects.filter(pk=client.pk).delete()
    assert Client.objects.filter(pk=client.pk).exists()


def test_no_foreign_key_can_cascade_a_hard_delete_into_synced_rows() -> None:
    # Collector cascades and SET_NULL skip delete()/save(), so only PROTECT is safe, both
    # for foreign keys on synced rows and for foreign keys pointing at them.
    synced = set(synced_models().values())
    checked = 0
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if not field.is_relation or not (model in synced or field.related_model in synced):
                continue
            assert not field.many_to_many, f"{model.__name__}.{field.name}"
            if field.concrete:
                on_delete = getattr(field.remote_field, "on_delete", None)
                assert on_delete is models.PROTECT, f"{model.__name__}.{field.name}"
                checked += 1
    assert (
        checked >= 5
    )  # session.client, payment.session/client, reading.session, card_draw.reading


def test_tombstone_is_stamped_by_the_server_in_milliseconds() -> None:
    client = factories.ClientFactory()
    version = client.server_version

    client.tombstone()

    client.refresh_from_db()
    assert client.deleted_at == client.updated_at
    assert client.updated_at.microsecond % 1000 == 0
    assert client.device_id == SERVER_DEVICE_ID
    assert client.server_version > version


def test_server_written_horoscopes_get_millisecond_timestamps() -> None:
    assert factories.HoroscopeFactory().updated_at.microsecond % 1000 == 0
