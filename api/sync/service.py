"""Push-then-pull sync (specs/plan.md, "Sync protocol"). The view only does HTTP."""

import datetime as dt
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, get_args

from django.db import IntegrityError, connection, transaction

from sync.models import (
    SERVER_DEVICE_ID,
    Conflict,
    SyncedModel,
    current_epoch,
    synced_write,
    to_ms,
)
from sync.registry import synced_models
from sync.serializers import format_timestamp, record_serializer

PULL_PAGE_SIZE = 500
# Further ahead than any time zone mistake; beyond it the device clock is simply wrong.
MAX_CLOCK_AHEAD = dt.timedelta(hours=24)
SERVER_OWNED_TABLES = frozenset({"horoscope"})
# Last-write-wins keeps the losing value of these as a `conflict` row (rule 2).
FREE_TEXT_FIELDS: Mapping[str, tuple[str, ...]] = {
    "client": ("notes",),
    "session": ("notes", "follow_up_note"),
    "payment": ("note",),
    "card_draw": ("note",),
    "card_note": ("note",),
}
# Never change: conflict ids are UUIDv5s under it, so a retried push finds its conflict.
CONFLICT_ID_NAMESPACE = uuid.UUID("6f1c2a52-3d0e-4d8b-9a57-7c0f3e1b2d94")

Key = tuple[str, uuid.UUID]
ErrorCode = Literal["invalid", "server_owned", "clock_ahead", "constraint", "missing_parent"]
ERROR_CODES: tuple[ErrorCode, ...] = get_args(ErrorCode)


class PushRejected(Exception):
    """The push is invalid as a whole; nothing was applied."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__(errors)
        self.errors = errors


@dataclass
class SyncResult:
    applied: list[uuid.UUID] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    changes: list[SyncedModel] = field(default_factory=list)
    cursor: int = 0
    epoch: uuid.UUID | None = None


def table_of(row: SyncedModel) -> str:
    return row._meta.db_table


def sync(
    device_id: uuid.UUID, cursor: int, changes: Sequence[Mapping[str, Any]], now: dt.datetime
) -> SyncResult:
    """Apply a device's pending rows, then return the next page of rows it hasn't seen."""
    now = to_ms(now)
    with synced_write():
        validated = _validate(changes, now)
        result = SyncResult()
        written: set[Key] = set()
        returned: dict[Key, SyncedModel] = {}
        errors: list[dict[str, Any]] = []

        for index, (table, data) in enumerate(validated):
            try:
                with transaction.atomic():
                    _apply(table, data, device_id, cursor, now, result, written, returned)
            except IntegrityError as exc:
                errors.append(_error(index, table, data["id"], "constraint", str(exc)))
        if errors:
            raise PushRejected(errors)
        _check_deferred_constraints()

        page, result.cursor = _pull(cursor, exclude=written)
        for row in page:
            returned.setdefault((table_of(row), row.pk), row)
        result.changes = sorted(returned.values(), key=lambda row: row.server_version)
        result.epoch = current_epoch()
    return result


def _error(
    index: int | None, table: str | None, record_id: object, code: ErrorCode, detail: object
) -> dict[str, Any]:
    return {
        "index": index,
        "table": table,
        "id": None if record_id is None else str(record_id),
        "code": code,
        "detail": detail,
    }


def _validate(
    changes: Sequence[Mapping[str, Any]], now: dt.datetime
) -> list[tuple[str, dict[str, Any]]]:
    models = synced_models()
    validated: list[tuple[str, dict[str, Any]]] = []
    errors: list[dict[str, Any]] = []
    for index, change in enumerate(changes):
        table, record = change["table"], change["record"]
        record_id = record.get("id")
        if table in SERVER_OWNED_TABLES:
            errors.append(_error(index, table, record_id, "server_owned", "Server-owned table."))
            continue
        serializer = record_serializer(models[table])(data=record)
        if not serializer.is_valid():
            errors.append(_error(index, table, record_id, "invalid", serializer.errors))
            continue
        data = dict(serializer.validated_data)
        if data["updated_at"] > now + MAX_CLOCK_AHEAD:
            detail = f"updated_at is more than 24 h after server time {format_timestamp(now)}."
            errors.append(_error(index, table, record_id, "clock_ahead", detail))
            continue
        validated.append((table, data))
    if errors:
        raise PushRejected(errors)
    return validated


def _apply(
    table: str,
    data: dict[str, Any],
    device_id: uuid.UUID,
    cursor: int,
    now: dt.datetime,
    result: SyncResult,
    written: set[Key],
    returned: dict[Key, SyncedModel],
) -> None:
    model = synced_models()[table]
    stored = model.objects.filter(pk=data["id"]).first()
    data = {**data, "device_id": device_id}

    if stored is None:  # Rule 1.
        model(**data).save()
        written.add((table, data["id"]))
        result.applied.append(data["id"])
        return

    incoming = {
        name: data.get(name, getattr(stored, name)) for name in FREE_TEXT_FIELDS.get(table, ())
    }
    current = {name: getattr(stored, name) for name in incoming}
    # Only a write this device hasn't seen can clash with its edit.
    unseen = stored.device_id != device_id and stored.server_version > cursor

    if data["updated_at"] > stored.updated_at:  # Rules 2 and 4: overwrite.
        if unseen:
            _keep_losing_text(
                table,
                stored.pk,
                current,
                incoming,
                stored.updated_at,
                stored.device_id,
                now,
                result,
                returned,
            )
        for name, value in data.items():
            setattr(stored, name, value)
        stored.save()
        written.add((table, stored.pk))
        result.applied.append(stored.pk)
    elif data["updated_at"] == stored.updated_at and (
        stored.device_id == device_id or _same_content(stored, data)
    ):
        # The same write again (a retried push, or a pulled row echoed back): no-op.
        result.applied.append(stored.pk)
    else:  # Rule 3: reject; the device gets the server's row back.
        if unseen:
            _keep_losing_text(
                table,
                stored.pk,
                incoming,
                current,
                data["updated_at"],
                device_id,
                now,
                result,
                returned,
            )
        returned[(table, stored.pk)] = stored


def _same_content(stored: SyncedModel, data: Mapping[str, Any]) -> bool:
    """Every pushed field equals the stored one; `device_id` is the pusher's, not the row's."""
    return all(
        getattr(stored, name) == value for name, value in data.items() if name != "device_id"
    )


def _keep_losing_text(
    table: str,
    record_id: uuid.UUID,
    losing: Mapping[str, Any],
    winning: Mapping[str, Any],
    losing_updated_at: dt.datetime,
    losing_device_id: uuid.UUID,
    now: dt.datetime,
    result: SyncResult,
    returned: dict[Key, SyncedModel],
) -> None:
    for name, value in losing.items():
        if value == winning[name]:
            continue
        conflict_id = uuid.uuid5(
            CONFLICT_ID_NAMESPACE,
            f"{table}:{record_id}:{name}:{format_timestamp(losing_updated_at)}:{losing_device_id}",
        )
        conflict = Conflict.objects.filter(pk=conflict_id).first()
        if conflict is None:  # Insert only if absent: a retry must not reopen or duplicate it.
            conflict = Conflict(
                id=conflict_id,
                updated_at=now,
                device_id=SERVER_DEVICE_ID,
                table=table,
                record_id=record_id,
                field=name,
                losing_value=value,
                losing_device_id=losing_device_id,
                created_at=now,
            )
            conflict.save()
        result.conflicts.append(conflict)
        returned[("conflict", conflict.pk)] = conflict


def _check_deferred_constraints() -> None:
    """Foreign keys are checked at commit; check them now so a bad push gets a 400."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("SET CONSTRAINTS ALL DEFERRED")
    except IntegrityError as exc:
        raise PushRejected([_error(None, None, None, "missing_parent", str(exc))]) from exc


def _pull(cursor: int, exclude: set[Key]) -> tuple[list[SyncedModel], int]:
    """Rows after `cursor`, at most one page. Rows in `exclude` still advance the cursor."""
    candidates: list[SyncedModel] = []
    for model in synced_models().values():
        candidates.extend(
            model.objects.filter(server_version__gt=cursor).order_by("server_version")[
                :PULL_PAGE_SIZE
            ]
        )
    page = sorted(candidates, key=lambda row: row.server_version)[:PULL_PAGE_SIZE]
    next_cursor = page[-1].server_version if page else cursor
    return [row for row in page if (table_of(row), row.pk) not in exclude], next_cursor
