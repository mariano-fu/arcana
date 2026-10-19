from django.apps import apps

from sync.models import SyncedModel


def synced_models() -> dict[str, type[SyncedModel]]:
    """Every synced model keyed by its sync table name (`db_table`), across all apps."""
    return {
        model._meta.db_table: model for model in apps.get_models() if issubclass(model, SyncedModel)
    }
