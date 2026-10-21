from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from core.schema import ErrorDetailSerializer
from sync import service
from sync.models import now_ms
from sync.schema import (
    SYNC_BAD_REQUEST,
    SyncResponseSerializer,
    SyncSerializer,
)
from sync.serializers import SyncRequestSerializer, format_timestamp, record_serializer


@extend_schema(
    request=SyncSerializer,
    responses={
        200: SyncResponseSerializer,
        400: OpenApiResponse(
            SYNC_BAD_REQUEST,
            description="Nothing applied: per-record `records`, or DRF field errors.",
        ),
        401: ErrorDetailSerializer,
    },
)
@api_view(["POST"])
def sync(request: Request) -> Response:
    """Push pending rows, pull the next page (specs/plan.md, "Sync protocol").

    A 400 means nothing was applied: request errors come as DRF field errors, record
    errors as `records: [{index, table, id, code, detail}]`.
    """
    body = SyncRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    now = now_ms()
    try:
        result = service.sync(
            body.validated_data["device_id"],
            body.validated_data["cursor"],
            body.validated_data["changes"],
            now,
        )
    except service.PushRejected as exc:
        return Response({"records": exc.errors}, status=400)
    return Response(
        {
            "results": [
                {"table": r.table, "id": str(r.id), "status": r.status} for r in result.results
            ],
            "conflicts": [
                {"table": c.table, "id": str(c.record_id), "field": c.field}
                for c in result.conflicts
            ],
            "changes": [
                {"table": service.table_of(row), "record": record_serializer(type(row))(row).data}
                for row in result.changes
            ],
            "cursor": result.cursor,
            "server_time": format_timestamp(now),
            "epoch": str(result.epoch),
        }
    )
