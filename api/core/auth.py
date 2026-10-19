from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class LoginView(TokenObtainPairView):
    """Username + password → access and refresh tokens. Throttled (plan.md, Security)."""

    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"


class RefreshView(TokenRefreshView):
    """Refresh token → new access token and a rotated refresh token; the old one is blacklisted."""

    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"
