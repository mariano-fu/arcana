"""OpenAPI description of `POST /api/sync/` (drf-spectacular).

The endpoint validates with `sync.serializers`; these serializers only document it. The
record components are the runtime `record_serializer` classes, so field lists can't drift.
"""

from typing import Any

from drf_spectacular.utils import PolymorphicProxySerializer, extend_schema_field
from rest_framework import serializers

from sync.models import SYNCED_TABLE_NAMES
from sync.registry import synced_models
from sync.serializers import TimestampField, record_serializer
from sync.service import ERROR_CODES, SERVER_OWNED_TABLES


def _change_serializer(table: str, prefix: str) -> type[serializers.Serializer[Any]]:
    model = synced_models()[table]
    # Becomes an inline single-value enum in `postprocess`, after spectacular's enum hook,
    # which would otherwise pull each one out into a colliding `TableEnum` component.
    tag = extend_schema_field({"type": "string", "x-table": table})(
        type(f"{model.__name__}Tag", (serializers.CharField,), {})
    )
    return type(
        f"{prefix}{model.__name__}ChangeSerializer",
        (serializers.Serializer,),
        {"table": tag(), "record": record_serializer(model)()},
    )


def _changes(
    component_name: str, tables: list[str], prefix: str, **kwargs: Any
) -> PolymorphicProxySerializer:
    return PolymorphicProxySerializer(
        component_name=component_name,
        serializers={table: _change_serializer(table, prefix) for table in tables},
        resource_type_field_name="table",
        many=True,
        **kwargs,
    )


PUSHABLE_TABLES = [t for t in SYNCED_TABLE_NAMES if t not in SERVER_OWNED_TABLES]


class SyncSerializer(serializers.Serializer[dict[str, Any]]):
    device_id = serializers.UUIDField()
    cursor = serializers.IntegerField(min_value=0, required=False, help_text="Default 0.")
    changes = _changes("PushChange", PUSHABLE_TABLES, "Push", required=False)


class ConflictRefSerializer(serializers.Serializer[dict[str, Any]]):
    table = serializers.ChoiceField(choices=SYNCED_TABLE_NAMES)
    id = serializers.UUIDField(help_text="The record's id, not the conflict row's.")
    field = serializers.CharField()


class SyncResponseSerializer(serializers.Serializer[dict[str, Any]]):
    applied = serializers.ListField(child=serializers.UUIDField())
    conflicts = ConflictRefSerializer(many=True)
    changes = _changes("PulledChange", list(SYNCED_TABLE_NAMES), "Pulled")
    cursor = serializers.IntegerField()
    server_time = TimestampField()


class RecordErrorSerializer(serializers.Serializer[dict[str, Any]]):
    index = serializers.IntegerField(allow_null=True, help_text="Position in `changes`.")
    table = serializers.ChoiceField(choices=SYNCED_TABLE_NAMES, allow_null=True)
    id = serializers.UUIDField(allow_null=True)
    code = serializers.ChoiceField(choices=ERROR_CODES)
    detail = serializers.JSONField(help_text="A message, or DRF field errors for `invalid`.")


class SyncRejectedSerializer(serializers.Serializer[dict[str, Any]]):
    records = RecordErrorSerializer(many=True)


# `postprocess` adds the second branch, `FieldErrors`; spectacular drops field-less serializers.
SYNC_BAD_REQUEST = PolymorphicProxySerializer(
    component_name="SyncBadRequest",
    serializers=[SyncRejectedSerializer],
    resource_type_field_name=None,
)


def postprocess(result: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Tighten the generated schema so the TS types are exact.

    - Response objects always carry every field (nullable ones as null), so all their
      properties are required; spectacular leaves optional ones (e.g. blank `notes`) out.
    - `FieldErrors` is a free-form object: `{field: errors}`.
    - Each change's `table` is a single-value enum, the union's discriminator.
    """
    schemas: dict[str, Any] = result.get("components", {}).get("schemas", {})
    for name, schema in schemas.items():
        properties: dict[str, Any] = schema.get("properties", {})
        for key, prop in properties.items():
            if "x-table" in prop:
                properties[key] = {"type": "string", "enum": [prop["x-table"]]}
        if properties and not name.endswith("Request"):
            schema["required"] = list(properties)
    if "SyncBadRequest" in schemas:
        schemas["FieldErrors"] = {
            "type": "object",
            "description": "DRF field errors for a malformed request: `{field: errors}`.",
            "additionalProperties": {},
        }
        schemas["SyncBadRequest"]["oneOf"].append({"$ref": "#/components/schemas/FieldErrors"})
    return result
