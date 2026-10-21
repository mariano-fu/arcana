from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from core.schema import HealthDownSerializer, HealthSerializer


@extend_schema(responses={200: HealthSerializer, 503: HealthDownSerializer})
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request: Request) -> Response:
    """Liveness + database check. The only endpoint that needs no auth (constitution §2)."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return Response({"status": "error", "database": "unavailable"}, status=503)
    return Response({"status": "ok"})
