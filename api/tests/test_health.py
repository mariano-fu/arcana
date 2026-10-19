from unittest.mock import patch

import pytest
from django.db import OperationalError
from django.urls import path
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIClient

from arcana.urls import urlpatterns as project_urlpatterns


@api_view(["GET"])
def protected(request: Request) -> Response:
    return Response({"ok": True})


urlpatterns = [*project_urlpatterns, path("api/protected/", protected)]


@pytest.mark.django_db
def test_health_is_public_and_checks_database() -> None:
    response = APIClient().get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_health_reports_database_outage() -> None:
    with patch("core.views.connection.cursor", side_effect=OperationalError("down")):
        response = APIClient().get("/api/health/")

    assert response.status_code == 503
    assert response.json()["status"] == "error"


@pytest.mark.urls("tests.test_health")
def test_endpoints_require_auth_by_default() -> None:
    response = APIClient().get("/api/protected/")

    assert response.status_code == 401


@pytest.mark.django_db
def test_api_responds_with_json_only() -> None:
    response = APIClient().get("/api/health/", HTTP_ACCEPT="text/html")

    assert response.status_code == 406
