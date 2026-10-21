"""Response shapes shared by the OpenAPI description of several endpoints."""

from typing import Any

from rest_framework import serializers


class ErrorDetailSerializer(serializers.Serializer[dict[str, Any]]):
    """DRF's error body for 401, 403 and 429."""

    detail = serializers.CharField()


class HealthSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=["ok"])


class HealthDownSerializer(serializers.Serializer[dict[str, Any]]):
    status = serializers.ChoiceField(choices=["error"])
    database = serializers.ChoiceField(choices=["unavailable"])
