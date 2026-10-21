from datetime import timedelta
from typing import Any

import pytest
from django.conf import settings
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import AccessToken

pytestmark = [pytest.mark.django_db, pytest.mark.urls("tests.test_health")]

LOGIN = "/api/auth/token/"
REFRESH = "/api/auth/token/refresh/"
PASSWORD = "test-only-password"  # noqa: S105 - test fixture, not a real secret


@pytest.fixture
def user() -> User:
    return User.objects.create_user(username="reader", password=PASSWORD)


def login(username: str = "reader", password: str = PASSWORD) -> Any:
    return APIClient().post(LOGIN, {"username": username, "password": password}, format="json")


def refresh(token: str) -> Any:
    return APIClient().post(REFRESH, {"refresh": token}, format="json")


def test_login_returns_access_and_refresh_tokens(user: User) -> None:
    response = login()

    assert response.status_code == 200
    assert set(response.json()) == {"access", "refresh"}


@pytest.mark.parametrize(("username", "password"), [("reader", "wrong"), ("nobody", PASSWORD)])
def test_login_rejects_bad_credentials(user: User, username: str, password: str) -> None:
    response = login(username, password)

    assert response.status_code == 401
    assert "access" not in response.json()


def test_access_token_authenticates_protected_endpoints(user: User) -> None:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login().json()['access']}")

    assert client.get("/api/protected/").status_code == 200


def test_invalid_access_token_is_rejected(user: User) -> None:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")

    assert client.get("/api/protected/").status_code == 401


def test_expired_access_token_is_rejected(user: User) -> None:
    token = AccessToken.for_user(user)
    token.set_exp(lifetime=-timedelta(seconds=1))
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    assert client.get("/api/protected/").status_code == 401


def test_token_lifetimes_match_plan() -> None:
    assert settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"] == timedelta(minutes=15)
    assert settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"] == timedelta(days=30)


def test_refresh_rotates_the_refresh_token(user: User) -> None:
    old = login().json()["refresh"]

    response = refresh(old)

    assert response.status_code == 200
    assert set(response.json()) == {"access", "refresh"}
    assert response.json()["refresh"] != old


def test_rotated_refresh_token_cannot_be_reused(user: User) -> None:
    old = login().json()["refresh"]
    new = refresh(old).json()["refresh"]

    assert refresh(old).status_code == 401
    assert refresh(new).status_code == 200


def test_refresh_rejects_garbage(user: User) -> None:
    assert refresh("not-a-token").status_code == 401


@pytest.mark.parametrize("endpoint", [LOGIN, REFRESH])
def test_auth_endpoints_are_throttled(user: User, endpoint: str) -> None:
    # The configured rate, not an override: DRF binds throttle rates at import time.
    # The cache (throttle counts) is cleared before each test in conftest.py.
    limit, _ = ScopedRateThrottle().parse_rate(ScopedRateThrottle.THROTTLE_RATES["auth"])
    assert limit is not None
    client = APIClient()
    statuses = [client.post(endpoint, {}, format="json").status_code for _ in range(limit + 1)]

    assert statuses[:limit] == [400] * limit
    assert statuses[limit] == 429


def test_health_stays_public_with_a_stale_token() -> None:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")

    assert client.get("/api/health/").status_code == 200


# Example addresses only: devices on the tailnet range (RFC 6598), proxies from RFC 5737.
PROXY = "192.0.2.10"
DEVICE_A = "100.64.0.1"
DEVICE_B = "100.64.0.2"


def behind_two_proxies() -> Any:
    """The deployed chain: tailscale serve and Caddy each append one X-Forwarded-For entry."""
    return override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 2})


def login_from(xff: str) -> int:
    response = APIClient().post(
        LOGIN, {}, format="json", HTTP_X_FORWARDED_FOR=xff, REMOTE_ADDR="192.0.2.20"
    )
    return response.status_code


def auth_limit() -> int:
    limit, _ = ScopedRateThrottle().parse_rate(ScopedRateThrottle.THROTTLE_RATES["auth"])
    assert limit is not None
    return limit


def test_behind_the_proxy_chain_throttling_keys_on_the_device() -> None:
    with behind_two_proxies():
        statuses = [login_from(f"{DEVICE_A}, {PROXY}") for _ in range(auth_limit() + 1)]

        assert statuses[-1] == 429
        # Another device behind the same proxies has its own bucket.
        assert login_from(f"{DEVICE_B}, {PROXY}") == 400


def test_a_client_sent_x_forwarded_for_does_not_pick_the_bucket() -> None:
    with behind_two_proxies():
        for _ in range(auth_limit()):
            login_from(f"{DEVICE_A}, {PROXY}")

        # The device prepends its own value: the proxies' entries still decide.
        assert login_from(f"203.0.113.9, {DEVICE_A}, {PROXY}") == 429
        assert login_from(f"203.0.113.9, {DEVICE_B}, {PROXY}") == 400


def test_by_default_x_forwarded_for_is_ignored() -> None:
    # 0, not unset: with None, DRF keys on the whole header and a client could vary it.
    assert settings.REST_FRAMEWORK["NUM_PROXIES"] == 0
    for _ in range(auth_limit()):
        login_from(f"{DEVICE_A}, {PROXY}")

    # Keyed by REMOTE_ADDR, so a different X-Forwarded-For shares the bucket.
    assert login_from(f"{DEVICE_B}, {PROXY}") == 429
    assert login_from("203.0.113.77") == 429
