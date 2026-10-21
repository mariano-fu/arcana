"""The OpenAPI schema (`openapi.yaml`, /api/schema/) that the web client's types come from."""

from pathlib import Path
from typing import Any

import pytest
import yaml
from django.contrib.auth.models import User
from django.core.management import call_command
from rest_framework.test import APIClient

API_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def schema(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    out = tmp_path_factory.mktemp("schema") / "openapi.yaml"
    call_command("spectacular", "--validate", "--fail-on-warn", "--file", str(out))
    loaded: dict[str, Any] = yaml.safe_load(out.read_text())
    return loaded


def test_committed_schema_is_up_to_date(tmp_path: Path) -> None:
    out = tmp_path / "openapi.yaml"
    call_command("spectacular", "--file", str(out))

    message = (
        "api/openapi.yaml is stale: run `uv run python manage.py spectacular --file openapi.yaml`"
    )
    assert out.read_text() == (API_DIR / "openapi.yaml").read_text(), message


@pytest.mark.django_db
def test_schema_endpoint_requires_auth() -> None:
    client = APIClient()

    assert client.get("/api/schema/").status_code == 401
    client.force_authenticate(User.objects.create_user(username="reader"))
    assert client.get("/api/schema/").status_code == 200


def responses(schema: dict[str, Any], path: str, method: str) -> set[str]:
    return set(schema["paths"][path][method]["responses"])


def test_auth_endpoints_document_throttling(schema: dict[str, Any]) -> None:
    for path in ("/api/auth/token/", "/api/auth/token/refresh/"):
        assert responses(schema, path, "post") == {"200", "401", "429"}


def test_sync_documents_its_errors(schema: dict[str, Any]) -> None:
    assert responses(schema, "/api/sync/", "post") == {"200", "400", "401"}
    codes = schema["components"]["schemas"]["RecordErrorCodeEnum"]["enum"]
    assert set(codes) == {"invalid", "server_owned", "clock_ahead", "constraint", "missing_parent"}


def test_only_health_and_login_are_public(schema: dict[str, Any]) -> None:
    public = {
        path
        for path, operations in schema["paths"].items()
        for operation in operations.values()
        if {"jwtAuth": []} not in operation.get("security", [])
    }
    # Logging in and refreshing are how a client gets a token in the first place.
    assert public == {"/api/health/", "/api/auth/token/", "/api/auth/token/refresh/"}


def test_response_records_require_every_field(schema: dict[str, Any]) -> None:
    record = schema["components"]["schemas"]["ClientRecord"]

    assert set(record["required"]) == set(record["properties"])
    assert record["properties"]["birth_time"]["pattern"] == "^([01][0-9]|2[0-3]):[0-5][0-9]$"


def test_horoscopes_are_pulled_but_never_pushed(schema: dict[str, Any]) -> None:
    schemas = schema["components"]["schemas"]

    assert "horoscope" in schemas["PulledChange"]["discriminator"]["mapping"]
    assert "horoscope" not in schemas["PushChangeRequest"]["discriminator"]["mapping"]
