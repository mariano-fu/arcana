from django.apps import AppConfig


class OpsConfig(AppConfig):
    """Deploy operations: database backups and restores (no models)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "ops"
