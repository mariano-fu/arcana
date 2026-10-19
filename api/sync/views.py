from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from sync import service
from sync.serializers import SyncRequestSerializer, format_timestamp, record_serializer


@api_view(["POST"])
def sync(request: Request) -> Response:
    """Push pending rows, pull the next page (specs/plan.md, "Sync protocol").

    A 400 means nothing was applied: request errors come as DRF field errors, record
    errors as `records: [{index, table, id, code, detail}]`.
    """
    body = SyncRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    now = timezone.now()
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
            "applied": [str(record_id) for record_id in result.applied],
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
        }
    )
