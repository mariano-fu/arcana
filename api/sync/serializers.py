"""Wire format of `POST /api/sync/` (specs/plan.md, "Sync protocol")."""

import datetime as dt
from functools import cache
from typing import Any, ClassVar

from django.db import models
from rest_framework import serializers

from sync.models import SyncedModel
from sync.registry import synced_models

PUSH_LIMIT = 500


def format_timestamp(value: dt.datetime) -> str:
    """ISO 8601 UTC with millisecond precision, the shape of JS `Date.toISOString()`.

    One fixed width, so the client can keep comparing timestamps as strings.
    """
    utc = value.astimezone(dt.UTC)
    return f"{utc:%Y-%m-%dT%H:%M:%S}.{utc.microsecond // 1000:03d}Z"


class TimestampField(serializers.DateTimeField):
    def to_representation(self, value: dt.datetime) -> str:
        return format_timestamp(value)


class SyncRecordSerializer(serializers.ModelSerializer[SyncedModel]):
    serializer_field_mapping: ClassVar = {
        **serializers.ModelSerializer.serializer_field_mapping,
        models.DateTimeField: TimestampField,
    }


@cache
def record_serializer(model: type[SyncedModel]) -> type[SyncRecordSerializer]:
    """Serializer for one table's rows. Foreign keys travel as `<name>_id` UUIDs.

    `id` is declared explicitly so DRF adds no uniqueness check (updates reuse it), and
    `device_id` is optional because the server takes it from the request.
    """
    concrete = model._meta.concrete_fields
    declared: dict[str, Any] = {
        field.attname: serializers.UUIDField() for field in concrete if field.is_relation
    }
    declared["id"] = serializers.UUIDField()
    declared["device_id"] = serializers.UUIDField(required=False)
    meta = type(
        "Meta",
        (),
        {
            "model": model,
            "fields": [field.attname for field in concrete],
            "read_only_fields": ["server_version"],
        },
    )
    return type(
        f"{model.__name__}RecordSerializer", (SyncRecordSerializer,), {"Meta": meta, **declared}
    )


class ChangeSerializer(serializers.Serializer[dict[str, Any]]):
    table = serializers.ChoiceField(choices=sorted(synced_models()))
    record = serializers.DictField()


class SyncRequestSerializer(serializers.Serializer[dict[str, Any]]):
    device_id = serializers.UUIDField()
    cursor = serializers.IntegerField(min_value=0, default=0)
    changes = serializers.ListField(child=ChangeSerializer(), max_length=PUSH_LIMIT, default=list)
