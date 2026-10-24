"""`POST /api/sync/` against the rules in specs/plan.md, "Sync protocol"."""

import datetime as dt
import io
import uuid
from typing import Any

import pytest
from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from sync.models import (
    SERVER_DEVICE_ID,
    CardNote,
    Client,
    Conflict,
    Session,
    SessionCrystal,
    SyncedModel,
    SyncEpoch,
    current_epoch,
)
from sync.serializers import format_timestamp, record_serializer
from sync.service import PULL_PAGE_SIZE
from tests import factories

pytestmark = pytest.mark.django_db

SYNC = "/api/sync/"
DEVICE_A = factories.DEVICE_A
DEVICE_B = uuid.UUID("0190a000-0000-7000-8000-00000000000b")


@pytest.fixture
def api() -> APIClient:
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username="reader"))
    return client


BASE_TIME = timezone.now().replace(second=0, microsecond=0) - dt.timedelta(hours=1)


def at(minutes: float) -> dt.datetime:
    """A client timestamp (millisecond precision, like JS) relative to about an hour ago."""
    return BASE_TIME + dt.timedelta(minutes=minutes)


def change(row: SyncedModel, **overrides: Any) -> dict[str, Any]:
    record = dict(record_serializer(type(row))(row).data)
    record.pop("server_version", None)
    for name, value in overrides.items():
        record[name] = format_timestamp(value) if isinstance(value, dt.datetime) else value
    return {"table": row._meta.db_table, "record": record}


def push(api: APIClient, device: uuid.UUID, changes: list[dict[str, Any]], cursor: int = 0) -> Any:
    response = api.post(
        SYNC, {"device_id": str(device), "cursor": cursor, "changes": changes}, format="json"
    )
    return response


def results(body: dict[str, Any]) -> list[tuple[str, uuid.UUID, str]]:
    """The push results as (table, id, status), in request order."""
    return [(r["table"], uuid.UUID(r["id"]), r["status"]) for r in body["results"]]


def ok(response: Any) -> dict[str, Any]:
    assert response.status_code == 200, response.json()
    body: dict[str, Any] = response.json()
    return body


def pulled(body: dict[str, Any], table: str) -> dict[str, dict[str, Any]]:
    return {c["record"]["id"]: c["record"] for c in body["changes"] if c["table"] == table}


def new_client(**fields: Any) -> Client:
    client: Client = factories.ClientFactory.build(**fields)
    return client


def stored(model: type[SyncedModel], record_id: Any) -> Any:
    return model.objects.get(pk=record_id)


# --- Basics -----------------------------------------------------------------------------


def test_sync_requires_auth() -> None:
    response = APIClient().post(SYNC, {"device_id": str(DEVICE_A)}, format="json")

    assert response.status_code == 401


def test_new_rows_are_inserted_with_server_versions(api: APIClient) -> None:
    client = new_client(updated_at=at(1))
    session = factories.SessionFactory.build(client=client, updated_at=at(1))

    # Child first: a push isn't ordered by dependency.
    body = ok(push(api, DEVICE_A, [change(session), change(client)]))

    assert results(body) == [("session", session.id, "applied"), ("client", client.id, "applied")]
    assert stored(Session, session.id).client_id == client.id
    assert stored(Client, client.id).server_version > 0


def test_server_takes_device_and_server_version_from_itself(api: APIClient) -> None:
    earlier = factories.CardNoteFactory()
    client = new_client(updated_at=at(1))

    ok(push(api, DEVICE_A, [change(client, device_id=str(DEVICE_B), server_version=1)]))

    row = stored(Client, client.id)
    assert row.device_id == DEVICE_A
    assert row.server_version > earlier.server_version


def test_response_reports_server_time_and_millisecond_timestamps(api: APIClient) -> None:
    factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1))
    before = timezone.now()

    body = ok(push(api, DEVICE_A, []))

    server_time = dt.datetime.fromisoformat(body["server_time"])
    assert before - dt.timedelta(seconds=1) <= server_time <= timezone.now()
    record = body["changes"][0]["record"]
    assert len(record["updated_at"]) == len("2026-10-19T12:00:00.000Z")
    assert record["updated_at"] == format_timestamp(at(1))


def test_timestamps_are_compared_in_milliseconds(api: APIClient) -> None:
    client = new_client(updated_at=at(1))
    micro = change(client)
    micro["record"]["updated_at"] = micro["record"]["updated_at"].replace(".000Z", ".000999Z")

    ok(push(api, DEVICE_A, [micro]))
    version = stored(Client, client.id).server_version
    body = ok(push(api, DEVICE_B, [change(client)]))  # The ms echo, from another device.

    assert stored(Client, client.id).updated_at == at(1)
    assert results(body) == [("client", client.id, "noop")]
    assert stored(Client, client.id).server_version == version


def test_server_time_has_millisecond_precision(api: APIClient) -> None:
    server_time = ok(push(api, DEVICE_A, []))["server_time"]

    assert server_time.endswith("Z")
    assert len(server_time) == len("2026-10-19T12:00:00.000Z")


def test_birth_time_round_trips_as_hours_and_minutes(api: APIClient) -> None:
    client = new_client(updated_at=at(1))

    ok(push(api, DEVICE_A, [change(client, birth_time="14:03")]))
    body = ok(push(api, DEVICE_B, []))

    assert pulled(body, "client")[str(client.id)]["birth_time"] == "14:03"
    assert stored(Client, client.id).birth_time == dt.time(14, 3)


def test_birth_time_with_zero_seconds_is_accepted(api: APIClient) -> None:
    client = new_client(updated_at=at(1))

    ok(push(api, DEVICE_A, [change(client, birth_time="14:03:00")]))

    assert stored(Client, client.id).birth_time == dt.time(14, 3)


@pytest.mark.parametrize("value", ["14:03:30", "14:03:00.5"])
def test_birth_time_with_seconds_is_rejected(api: APIClient, value: str) -> None:
    client = new_client(updated_at=at(1))

    response = push(api, DEVICE_A, [change(client, birth_time=value)])

    assert response.status_code == 400
    [error] = response.json()["records"]
    assert error["code"] == "invalid"
    assert "birth_time" in error["detail"]
    assert_nothing_applied(client)


def test_upload_limit_fits_a_full_push() -> None:
    assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE == 10 * 1024 * 1024


# --- Pull -------------------------------------------------------------------------------


def test_pull_returns_other_devices_rows_with_versions_and_foreign_keys(api: APIClient) -> None:
    session = factories.SessionFactory(device_id=DEVICE_B)
    horoscope = factories.HoroscopeFactory()

    body = ok(push(api, DEVICE_A, []))

    record = pulled(body, "session")[str(session.id)]
    assert record["client_id"] == str(session.client_id)
    assert record["server_version"] == session.server_version
    assert str(horoscope.id) in pulled(body, "horoscope")
    assert body["cursor"] == max(c["record"]["server_version"] for c in body["changes"])


def test_pull_leaves_out_rows_this_push_wrote_but_moves_past_them(api: APIClient) -> None:
    client = new_client(updated_at=at(1))

    body = ok(push(api, DEVICE_A, [change(client)]))

    assert body["changes"] == []
    assert body["cursor"] == stored(Client, client.id).server_version
    assert ok(push(api, DEVICE_A, [], cursor=body["cursor"]))["changes"] == []


def test_pull_pages_until_the_cursor_stops_advancing(api: APIClient) -> None:
    total = 2 * PULL_PAGE_SIZE + 1
    for _ in range(total):
        factories.CardNoteFactory(device_id=DEVICE_B)

    seen: set[str] = set()
    sizes: list[int] = []
    cursor = 0
    while True:
        body = ok(push(api, DEVICE_A, [], cursor=cursor))
        if body["cursor"] == cursor:
            break
        sizes.append(len(body["changes"]))
        seen |= set(pulled(body, "card_note"))
        cursor = body["cursor"]

    assert sizes == [PULL_PAGE_SIZE, PULL_PAGE_SIZE, 1]
    assert len(seen) == total
    assert body["changes"] == []


# --- Last-write-wins (rules 1-3) --------------------------------------------------------


def test_newer_edit_overwrites(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1), name="Before")

    body = ok(push(api, DEVICE_A, [change(client, name="After", updated_at=at(2))]))

    assert results(body) == [("client", client.id, "applied")]
    row = stored(Client, client.id)
    assert (row.name, row.updated_at, row.device_id) == ("After", at(2), DEVICE_A)


def test_older_edit_is_rejected_and_the_server_row_returned(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2), name="Newer")
    version = client.server_version

    body = ok(push(api, DEVICE_A, [change(client, name="Older", updated_at=at(1))]))

    assert results(body) == [("client", client.id, "rejected")]
    assert pulled(body, "client")[str(client.id)]["name"] == "Newer"
    assert stored(Client, client.id).server_version == version


def test_rejected_row_is_returned_even_if_the_cursor_is_past_it(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2))

    body = ok(push(api, DEVICE_A, [change(client, updated_at=at(1))], cursor=client.server_version))

    assert str(client.id) in pulled(body, "client")


def test_equal_updated_at_from_another_device_is_rejected(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1), name="B")

    body = ok(push(api, DEVICE_A, [change(client, name="A")]))

    assert results(body) == [("client", client.id, "rejected")]
    assert stored(Client, client.id).name == "B"


def test_pulled_row_echoed_back_unchanged_is_a_no_op(api: APIClient) -> None:
    # Client-made rows carry ms timestamps throughout (factory defaults would carry µs).
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1), created_at=at(0))
    pull = ok(push(api, DEVICE_A, []))
    record = pulled(pull, "client")[str(client.id)]

    body = ok(push(api, DEVICE_A, [{"table": "client", "record": record}], cursor=pull["cursor"]))

    assert results(body) == [("client", client.id, "noop")]
    assert stored(Client, client.id).server_version == client.server_version


def test_server_created_conflict_round_trips_as_a_no_op(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(1), notes="From A")
    created = ok(push(api, DEVICE_B, [change(client, notes="From B", updated_at=at(2))]))
    record = pulled(created, "conflict")[str(Conflict.objects.get().id)]
    version = record["server_version"]
    assert record["updated_at"] == record["created_at"]
    assert dt.datetime.fromisoformat(record["updated_at"]).microsecond % 1000 == 0

    echo = ok(push(api, DEVICE_A, [{"table": "conflict", "record": record}], cursor=version))

    assert results(echo) == [("conflict", uuid.UUID(record["id"]), "noop")]
    assert pulled(echo, "conflict") == {}
    conflict = Conflict.objects.get()
    assert (conflict.server_version, conflict.resolved) == (version, False)
    assert conflict.device_id == SERVER_DEVICE_ID


def test_same_push_twice_is_idempotent(api: APIClient) -> None:
    client = new_client(updated_at=at(1), notes="Hello")
    session = factories.SessionFactory.build(client=client, updated_at=at(1))
    changes = [change(client), change(session)]

    first = ok(push(api, DEVICE_A, changes))
    versions = [
        stored(Client, client.id).server_version,
        stored(Session, session.id).server_version,
    ]
    second = ok(push(api, DEVICE_A, changes, cursor=first["cursor"]))

    assert [status for *_, status in results(first)] == ["applied", "applied"]
    # The retried push (its response was lost) writes nothing: every record is a noop.
    assert results(second) == [(t, i, "noop") for t, i, _ in results(first)]
    assert second["conflicts"] == []
    assert second["changes"] == []
    assert second["cursor"] == first["cursor"]
    assert [
        stored(Client, client.id).server_version,
        stored(Session, session.id).server_version,
    ] == versions
    assert (Client.objects.count(), Session.objects.count(), Conflict.objects.count()) == (1, 1, 0)


def test_concurrent_edits_on_two_devices_converge_on_the_newest(api: APIClient) -> None:
    base = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(0), name="Base")
    cursor = base.server_version
    a_edit = change(base, name="From A", updated_at=at(1))
    b_edit = change(base, name="From B", archived=True, updated_at=at(2))

    ok(push(api, DEVICE_B, [b_edit], cursor=cursor))
    a_body = ok(push(api, DEVICE_A, [a_edit], cursor=cursor))

    winner = pulled(a_body, "client")[str(base.id)]
    assert (winner["name"], winner["archived"]) == ("From B", True)
    assert stored(Client, base.id).name == "From B"


# --- Tombstones (rule 4) ----------------------------------------------------------------


def test_delete_wins_over_an_older_edit(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(0))
    cursor = client.server_version

    ok(push(api, DEVICE_A, [change(client, name="Edited", updated_at=at(1))], cursor=cursor))
    ok(push(api, DEVICE_B, [change(client, deleted_at=at(2), updated_at=at(2))], cursor=cursor))

    assert stored(Client, client.id).deleted_at == at(2)


def test_older_edit_after_a_delete_is_rejected_and_gets_the_tombstone(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2), deleted_at=at(2))

    body = ok(push(api, DEVICE_A, [change(client, deleted_at=None, updated_at=at(1))]))

    assert results(body) == [("client", client.id, "rejected")]
    assert pulled(body, "client")[str(client.id)]["deleted_at"] == format_timestamp(at(2))
    assert stored(Client, client.id).deleted_at == at(2)


def test_child_of_a_tombstoned_parent_is_accepted_and_both_are_pulled(api: APIClient) -> None:
    # Device A deleted the client; device B, offline, added a session to it.
    client = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(2), deleted_at=at(2))
    session = factories.SessionFactory.build(client=client, updated_at=at(3))

    body = ok(push(api, DEVICE_B, [change(session)]))

    assert results(body) == [("session", session.id, "applied")]
    assert stored(Client, client.id).deleted_at == at(2)
    body = ok(push(api, DEVICE_A, [], cursor=client.server_version - 1))
    assert pulled(body, "client")[str(client.id)]["deleted_at"] == format_timestamp(at(2))
    assert pulled(body, "session")[str(session.id)]["client_id"] == str(client.id)


# --- Free-text conflicts ----------------------------------------------------------------


def test_notes_conflict_preserves_the_overwritten_text(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(1), notes="From A")

    body = ok(push(api, DEVICE_B, [change(client, notes="From B", updated_at=at(2))]))

    conflict = Conflict.objects.get()
    assert (conflict.table, conflict.record_id, conflict.field) == ("client", client.id, "notes")
    assert (conflict.losing_value, conflict.losing_device_id) == ("From A", DEVICE_A)
    assert (conflict.resolved, conflict.device_id) == (False, SERVER_DEVICE_ID)
    assert body["conflicts"] == [{"table": "client", "id": str(client.id), "field": "notes"}]
    assert str(conflict.id) in pulled(body, "conflict")
    assert stored(Client, client.id).notes == "From B"


def test_each_free_text_field_gets_its_own_conflict(api: APIClient) -> None:
    session = factories.SessionFactory(
        device_id=DEVICE_A, updated_at=at(1), notes="A notes", follow_up_note="A follow-up"
    )

    ok(
        push(
            api,
            DEVICE_B,
            [change(session, notes="B notes", follow_up_note="B follow-up", updated_at=at(2))],
        )
    )

    assert set(Conflict.objects.values_list("field", "losing_value")) == {
        ("notes", "A notes"),
        ("follow_up_note", "A follow-up"),
    }


@pytest.mark.parametrize(
    ("factory", "field"),
    [
        (factories.PaymentFactory, "note"),
        (factories.CardDrawFactory, "note"),
        (factories.CardNoteFactory, "note"),
    ],
)
def test_other_free_text_fields_are_protected(api: APIClient, factory: Any, field: str) -> None:
    row = factory(device_id=DEVICE_A, updated_at=at(1), **{field: "From A"})

    ok(push(api, DEVICE_B, [change(row, **{field: "From B"}, updated_at=at(2))]))

    assert Conflict.objects.get().losing_value == "From A"


def test_no_conflict_for_a_version_the_device_had_already_seen(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(1), notes="From A")

    ok(
        push(
            api,
            DEVICE_B,
            [change(client, notes="From B", updated_at=at(2))],
            cursor=client.server_version,
        )
    )

    assert not Conflict.objects.exists()


def test_no_conflict_for_the_same_device_or_unchanged_text(api: APIClient) -> None:
    mine = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1), notes="Old")
    theirs = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(1), notes="Same")

    ok(
        push(
            api,
            DEVICE_B,
            [
                change(mine, notes="New", updated_at=at(2)),
                change(theirs, name="Renamed", updated_at=at(2)),
            ],
        )
    )

    assert not Conflict.objects.exists()


def test_rejected_push_keeps_its_losing_text(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2), notes="From B")

    body = ok(push(api, DEVICE_A, [change(client, notes="From A", updated_at=at(1))]))

    conflict = Conflict.objects.get()
    assert (conflict.losing_value, conflict.losing_device_id) == ("From A", DEVICE_A)
    assert body["conflicts"] == [{"table": "client", "id": str(client.id), "field": "notes"}]
    assert stored(Client, client.id).notes == "From B"


def test_retried_push_after_a_lost_response_keeps_exactly_one_conflict(api: APIClient) -> None:
    base = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(0), notes="Base")
    cursor = base.server_version
    x = change(base, notes="X", updated_at=at(1))

    ok(push(api, DEVICE_A, [x], cursor=cursor))  # Applied, but A never gets the response.
    ok(push(api, DEVICE_B, [change(base, notes="Y", updated_at=at(2))], cursor=cursor))
    assert list(Conflict.objects.values_list("losing_value", "losing_device_id")) == [
        ("X", DEVICE_A)
    ]

    retry = ok(push(api, DEVICE_A, [x], cursor=cursor))

    conflict = Conflict.objects.get()
    assert (conflict.losing_value, conflict.losing_device_id) == ("X", DEVICE_A)
    assert retry["conflicts"] == [{"table": "client", "id": str(base.id), "field": "notes"}]
    assert stored(Client, base.id).notes == "Y"


def test_existing_conflict_is_never_reopened_by_a_retry(api: APIClient) -> None:
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2), notes="From B")
    losing = change(client, notes="From A", updated_at=at(1))
    ok(push(api, DEVICE_A, [losing]))
    conflict = Conflict.objects.get()
    conflict.resolved = True
    conflict.save()

    ok(push(api, DEVICE_A, [losing]))

    assert Conflict.objects.get().resolved is True


def test_offline_for_a_week_then_sync(api: APIClient) -> None:
    week_ago = at(0) - dt.timedelta(days=7)
    shared = factories.ClientFactory(device_id=DEVICE_A, updated_at=week_ago, notes="Base")
    cursor = shared.server_version
    # During the week, B edits the shared client and adds plenty of rows.
    b_edit = change(shared, notes="B, midweek", updated_at=at(-3 * 24 * 60))
    ok(push(api, DEVICE_B, [b_edit], cursor=cursor))
    b_rows = [factories.CardNoteFactory(device_id=DEVICE_B) for _ in range(PULL_PAGE_SIZE)]
    # A, offline the whole time, edited the shared client and created one of its own.
    a_edit = change(shared, notes="A, offline", updated_at=week_ago + dt.timedelta(hours=1))
    a_new = new_client(updated_at=week_ago + dt.timedelta(hours=2))

    first = ok(push(api, DEVICE_A, [a_edit, change(a_new)], cursor=cursor))
    seen = set(pulled(first, "card_note"))
    cursor = first["cursor"]
    while (body := ok(push(api, DEVICE_A, [], cursor=cursor)))["cursor"] != cursor:
        seen |= set(pulled(body, "card_note"))
        cursor = body["cursor"]

    assert results(first) == [
        ("client", shared.id, "rejected"),
        ("client", a_new.id, "applied"),
    ]
    assert pulled(first, "client")[str(shared.id)]["notes"] == "B, midweek"
    assert Conflict.objects.get().losing_value == "A, offline"
    assert seen == {str(row.id) for row in b_rows}


# --- Rejected pushes: 400, nothing applied ----------------------------------------------


def assert_nothing_applied(*rows: SyncedModel) -> None:
    for row in rows:
        assert not type(row).objects.filter(pk=row.pk).exists()


def test_invalid_record_rejects_the_whole_push(api: APIClient) -> None:
    good = new_client(updated_at=at(1))
    bad = new_client(updated_at=at(1))

    response = push(api, DEVICE_A, [change(good), change(bad, name=None)])

    assert response.status_code == 400
    [error] = response.json()["records"]
    assert (error["index"], error["table"], error["id"]) == (1, "client", str(bad.id))
    assert error["code"] == "invalid"
    assert "name" in error["detail"]
    assert_nothing_applied(good, bad)


def test_missing_parent_rejects_the_whole_push(api: APIClient) -> None:
    good = new_client(updated_at=at(1))
    orphan = factories.SessionFactory.build(client=new_client(), updated_at=at(1))

    response = push(api, DEVICE_A, [change(good), change(orphan)])

    assert response.status_code == 400
    assert response.json()["records"][0]["code"] == "missing_parent"
    assert_nothing_applied(good, orphan)


def test_check_constraint_violation_rejects_the_whole_push(api: APIClient) -> None:
    draw = factories.CardDrawFactory.build(reading=factories.ReadingFactory(), updated_at=at(1))

    response = push(api, DEVICE_A, [change(draw, position_index=0)])

    assert response.status_code == 400
    assert response.json()["records"][0]["code"] == "constraint"
    assert_nothing_applied(draw)


def test_clients_cannot_write_server_owned_horoscopes(api: APIClient) -> None:
    horoscope = factories.HoroscopeFactory()

    response = push(api, DEVICE_A, [change(horoscope, text_en="Changed", updated_at=at(59))])

    assert response.status_code == 400
    assert response.json()["records"][0]["code"] == "server_owned"
    assert stored(type(horoscope), horoscope.id).text_en == "Test horoscope."


def test_unknown_table_is_rejected(api: APIClient) -> None:
    response = push(api, DEVICE_A, [{"table": "auth_user", "record": {}}])

    assert response.status_code == 400
    assert "changes" in response.json()


def test_push_over_the_row_cap_is_rejected(api: APIClient) -> None:
    changes = [change(new_client(updated_at=at(1))) for _ in range(501)]

    response = push(api, DEVICE_A, changes)

    assert response.status_code == 400
    assert "changes" in response.json()
    assert not Client.objects.exists()


def test_updated_at_more_than_a_day_ahead_rejects_the_whole_push(api: APIClient) -> None:
    good = new_client(updated_at=at(1))
    ahead = new_client(updated_at=timezone.now() + dt.timedelta(hours=24, minutes=1))

    response = push(api, DEVICE_A, [change(good), change(ahead)])

    assert response.status_code == 400
    [error] = response.json()["records"]
    assert (error["index"], error["code"]) == (1, "clock_ahead")
    assert_nothing_applied(good, ahead)


def test_updated_at_within_a_day_ahead_is_accepted(api: APIClient) -> None:
    ahead = new_client(updated_at=timezone.now() + dt.timedelta(hours=23))

    assert results(ok(push(api, DEVICE_A, [change(ahead)]))) == [("client", ahead.id, "applied")]


def test_card_note_round_trips_through_push_and_pull(api: APIClient) -> None:
    note = factories.CardNoteFactory.build(updated_at=at(1), note="Mine")

    ok(push(api, DEVICE_A, [change(note)]))
    body = ok(push(api, DEVICE_B, []))

    record = pulled(body, "card_note")[str(note.id)]
    assert (record["card_id"], record["note"], record["device_id"]) == (
        "cups-07",
        "Mine",
        str(DEVICE_A),
    )
    assert CardNote.objects.get().note == "Mine"


def test_session_crystal_round_trips_with_a_plain_crystal_reference(api: APIClient) -> None:
    # Seed crystals never sync unless edited, so the crystal may be unknown to the server.
    session = factories.SessionFactory(updated_at=at(0))
    unknown_crystal = uuid.uuid4()
    attached = factories.SessionCrystalFactory.build(
        session=session, crystal_id=unknown_crystal, updated_at=at(1)
    )

    ok(push(api, DEVICE_A, [change(attached)]))
    body = ok(push(api, DEVICE_B, []))

    record = pulled(body, "session_crystal")[str(attached.id)]
    assert (record["session_id"], record["crystal_id"]) == (str(session.id), str(unknown_crystal))
    assert stored(SessionCrystal, attached.id).crystal_id == unknown_crystal


def test_session_crystal_detach_and_reattach_reuse_the_row(api: APIClient) -> None:
    attached = factories.SessionCrystalFactory(updated_at=at(0))

    ok(push(api, DEVICE_A, [change(attached, deleted_at=at(1), updated_at=at(1))]))
    assert stored(SessionCrystal, attached.id).deleted_at == at(1)

    ok(push(api, DEVICE_B, [change(attached, deleted_at=None, updated_at=at(2))]))
    assert stored(SessionCrystal, attached.id).deleted_at is None
    assert SessionCrystal.objects.count() == 1


def test_session_crystal_without_its_session_rejects_the_push(api: APIClient) -> None:
    orphan = factories.SessionCrystalFactory.build(
        session=factories.SessionFactory.build(client=new_client()), updated_at=at(1)
    )

    response = push(api, DEVICE_A, [change(orphan)])

    assert response.status_code == 400
    assert response.json()["records"][0]["code"] == "missing_parent"
    assert not SessionCrystal.objects.exists()


def test_every_response_carries_the_database_epoch(api: APIClient) -> None:
    first = ok(push(api, DEVICE_A, []))["epoch"]
    second = ok(push(api, DEVICE_B, [], cursor=5))["epoch"]

    assert first == second == str(current_epoch())
    # Created by the migration, with the database.
    assert SyncEpoch.objects.filter(pk=1).exists()


def test_rotate_sync_epoch_gives_the_database_a_new_epoch(api: APIClient) -> None:
    before = ok(push(api, DEVICE_A, []))["epoch"]
    out = io.StringIO()

    call_command("rotate_sync_epoch", stdout=out)

    after = ok(push(api, DEVICE_A, []))["epoch"]
    assert after != before
    assert after in out.getvalue()
    assert SyncEpoch.objects.count() == 1


def test_results_give_one_status_per_pushed_record_in_request_order(api: APIClient) -> None:
    newer = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(1), name="Server")
    same = factories.ClientFactory(device_id=DEVICE_A, updated_at=at(1))
    winner = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(5), name="Server wins")
    fresh = new_client(updated_at=at(1))

    body = ok(
        push(
            api,
            DEVICE_A,
            [
                change(winner, name="Older", updated_at=at(2)),
                change(fresh),
                change(same),
                change(newer, name="Mine", updated_at=at(3)),
            ],
        )
    )

    assert results(body) == [
        ("client", winner.id, "rejected"),
        ("client", fresh.id, "applied"),
        ("client", same.id, "noop"),
        ("client", newer.id, "applied"),
    ]
    # Only the rejected record's server row comes back; written rows are left out.
    assert pulled(body, "client")[str(winner.id)]["name"] == "Server wins"
    assert str(newer.id) not in pulled(body, "client")
    assert str(fresh.id) not in pulled(body, "client")


def test_repush_after_a_lost_response_is_noop_with_the_old_cursor(api: APIClient) -> None:
    client = new_client(updated_at=at(1))
    ok(push(api, DEVICE_A, [change(client)]))  # Applied; the device never saw the response.
    version = stored(Client, client.id).server_version

    again = ok(push(api, DEVICE_A, [change(client)], cursor=0))

    assert results(again) == [("client", client.id, "noop")]
    assert stored(Client, client.id).server_version == version


def test_a_resolved_conflict_is_applied_and_a_retried_losing_push_does_not_reopen_it(
    api: APIClient,
) -> None:
    # B's newer notes win; A's older edit loses and is kept as a conflict.
    client = factories.ClientFactory(device_id=DEVICE_B, updated_at=at(2), notes="B")
    losing = change(client, notes="A", updated_at=at(1))
    first = ok(push(api, DEVICE_A, [losing]))
    conflict_record = pulled(first, "conflict")
    assert len(conflict_record) == 1
    (record,) = conflict_record.values()

    # A resolves it: resolved and tombstoned, stamped later than the server's own write.
    resolved_at = format_timestamp(timezone.now() + dt.timedelta(minutes=1))
    resolution = {
        "table": "conflict",
        "record": {
            **{k: v for k, v in record.items() if k != "server_version"},
            "resolved": True,
            "deleted_at": resolved_at,
            "updated_at": resolved_at,
        },
    }
    body = ok(push(api, DEVICE_A, [resolution], cursor=first["cursor"]))
    assert results(body) == [("conflict", uuid.UUID(record["id"]), "applied")]
    stored_conflict = stored(Conflict, record["id"])
    assert stored_conflict.resolved
    assert stored_conflict.deleted_at is not None
    version = stored_conflict.server_version

    # The original losing edit is pushed again (a retry from before the device saw anything).
    again = ok(push(api, DEVICE_A, [losing], cursor=0))

    assert results(again) == [("client", client.id, "rejected")]
    assert again["conflicts"] == []
    assert Conflict.objects.count() == 1
    unchanged = stored(Conflict, record["id"])
    assert (unchanged.resolved, unchanged.server_version) == (True, version)
    assert unchanged.deleted_at is not None
    # From cursor 0 the pull still lists it, as the tombstone it is now.
    assert pulled(again, "conflict")[record["id"]]["deleted_at"] is not None
