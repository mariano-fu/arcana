from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from core.schema import ErrorDetailSerializer

THROTTLED = OpenApiResponse(
    description="Throttled (`AUTH_THROTTLE_RATE`); `Retry-After` gives the seconds to wait.",
)


@extend_schema_view(
    post=extend_schema(
        responses={
            200: TokenObtainPairSerializer,
            401: ErrorDetailSerializer,
            429: THROTTLED,
        }
    )
)
class LoginView(TokenObtainPairView):
    """Username + password → access and refresh tokens. Throttled (plan.md, Security)."""

    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"


@extend_schema_view(
    post=extend_schema(
        responses={
            200: TokenRefreshSerializer,
            401: ErrorDetailSerializer,
            429: THROTTLED,
        }
    )
)
class RefreshView(TokenRefreshView):
    """Refresh token → new access token and a rotated refresh token; the old one is blacklisted."""

    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"
