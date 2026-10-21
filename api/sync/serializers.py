"""Wire format of `POST /api/sync/` (specs/plan.md, "Sync protocol")."""

import datetime as dt
from functools import cache
from typing import Any, ClassVar

from django.db import models
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from sync.models import SyncedModel, to_ms
from sync.registry import synced_models

PUSH_LIMIT = 500


def format_timestamp(value: dt.datetime) -> str:
    """ISO 8601 UTC with millisecond precision, the shape of JS `Date.toISOString()`.

    One fixed width, so the client can keep comparing timestamps as strings.
    """
    utc = value.astimezone(dt.UTC)
    return f"{utc:%Y-%m-%dT%H:%M:%S}.{utc.microsecond // 1000:03d}Z"


class TimestampField(serializers.DateTimeField):
    def to_internal_value(self, value: Any) -> dt.datetime:
        # Before any comparison: a µs-precise timestamp must equal its ms echo.
        return to_ms(super().to_internal_value(value))

    def to_representation(self, value: dt.datetime) -> str:
        return format_timestamp(value)


@extend_schema_field({"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"})
class ClockTimeField(serializers.TimeField):
    """Time of day as `HH:MM`, the client's `IsoTime`. `HH:MM:00` is accepted too."""

    default_error_messages: ClassVar = {"seconds": "Times travel as HH:MM, without seconds."}

    def to_internal_value(self, value: Any) -> dt.time:
        parsed = super().to_internal_value(value)
        if parsed.second or parsed.microsecond:
            self.fail("seconds")
        return parsed

    def to_representation(self, value: dt.time) -> str:
        return f"{value:%H:%M}"


# Shapes of the JSON columns, for the schema only: the server stores them as sent.
class SpreadLayoutSerializer(serializers.Serializer[dict[str, Any]]):
    col = serializers.IntegerField(min_value=0)
    row = serializers.IntegerField(min_value=0)
    rotated = serializers.BooleanField()


class SpreadPositionSerializer(serializers.Serializer[dict[str, Any]]):
    index = serializers.IntegerField(min_value=1, help_text="1-based.")
    name = serializers.CharField()
    meaning = serializers.CharField(allow_blank=True)
    layout = SpreadLayoutSerializer(allow_null=True)


class SpreadSnapshotSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField()
    positions = SpreadPositionSerializer(many=True)


@extend_schema_field(SpreadSnapshotSerializer)
class SpreadSnapshotField(serializers.JSONField):
    pass


@extend_schema_field(SpreadPositionSerializer(many=True))
class SpreadPositionsField(serializers.JSONField):
    pass


JSON_FIELDS: dict[tuple[str, str], type[serializers.JSONField]] = {
    ("reading", "spread_snapshot"): SpreadSnapshotField,
    ("spread_template", "positions"): SpreadPositionsField,
}


class SyncRecordSerializer(serializers.ModelSerializer[SyncedModel]):
    serializer_field_mapping: ClassVar = {
        **serializers.ModelSerializer.serializer_field_mapping,
        models.DateTimeField: TimestampField,
        models.TimeField: ClockTimeField,
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
    declared |= {
        name: field_class()
        for (table, name), field_class in JSON_FIELDS.items()
        if table == model._meta.db_table
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
