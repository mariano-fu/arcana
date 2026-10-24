from typing import TYPE_CHECKING, Any

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest

from sync import models

if TYPE_CHECKING:
    from django.contrib.admin.options import _ListFilterT


class SyncedModelAdmin(admin.ModelAdmin[Any]):
    """Shared columns are shown but never edited by hand (sync owns them).

    No hard deletes (devices would never hear of them): the "tombstone" action marks rows
    deleted instead, and the next sync deletes them on every device.
    """

    readonly_fields = ("server_version",)
    ordering = ("-server_version",)
    actions = ("tombstone",)

    def has_delete_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    @admin.action(description="Mark selected rows deleted (tombstone)")
    def tombstone(self, request: HttpRequest, queryset: QuerySet[Any]) -> None:
        rows = list(queryset.filter(deleted_at__isnull=True))
        for row in rows:
            row.tombstone()
        self.message_user(request, f"Marked {len(rows)} row(s) deleted.")

    def get_list_filter(self, request: HttpRequest) -> tuple["_ListFilterT", ...]:
        # Every list can show live rows or tombstones.
        return (*super().get_list_filter(request), ("deleted_at", admin.EmptyFieldListFilter))

    def get_readonly_fields(self, request: HttpRequest, obj: Any = None) -> tuple[str, ...]:
        # `id` is set on creation (the client always supplies one), then frozen.
        readonly = tuple(super().get_readonly_fields(request, obj))
        return (*readonly, "id") if obj is not None else readonly


@admin.register(models.Client)
class ClientAdmin(SyncedModelAdmin):
    list_display = ("name", "instagram", "whatsapp", "archived", "updated_at", "server_version")
    search_fields = ("name", "instagram", "whatsapp", "email", "notes")


@admin.register(models.Session)
class SessionAdmin(SyncedModelAdmin):
    list_display = ("started_at", "client", "type", "price_minor", "currency", "server_version")
    list_select_related = ("client",)
    search_fields = ("client__name", "notes", "follow_up_note")
    raw_id_fields = ("client",)


@admin.register(models.Payment)
class PaymentAdmin(SyncedModelAdmin):
    list_display = ("paid_at", "client", "amount_minor", "currency", "method", "server_version")
    list_select_related = ("client",)
    search_fields = ("client__name", "reference", "note")
    raw_id_fields = ("session", "client")


@admin.register(models.Reading)
class ReadingAdmin(SyncedModelAdmin):
    list_display = ("created_at", "label", "session", "spread_template_id", "server_version")
    search_fields = ("label",)
    raw_id_fields = ("session",)


@admin.register(models.CardDraw)
class CardDrawAdmin(SyncedModelAdmin):
    list_display = ("reading", "position_index", "card_id", "reversed", "server_version")
    search_fields = ("card_id", "note")
    raw_id_fields = ("reading",)


@admin.register(models.SpreadTemplate)
class SpreadTemplateAdmin(SyncedModelAdmin):
    list_display = ("name", "is_seed", "seed_key", "server_version")
    search_fields = ("name", "seed_key")


@admin.register(models.Crystal)
class CrystalAdmin(SyncedModelAdmin):
    list_display = ("name", "seed_key", "hidden", "user_modified", "server_version")
    search_fields = ("name", "seed_key")


@admin.register(models.IntentionTag)
class IntentionTagAdmin(SyncedModelAdmin):
    list_display = ("key", "label", "server_version")
    search_fields = ("key", "label")


@admin.register(models.CardNote)
class CardNoteAdmin(SyncedModelAdmin):
    list_display = ("card_id", "updated_at", "server_version")
    search_fields = ("card_id", "note")


@admin.register(models.SessionCrystal)
class SessionCrystalAdmin(SyncedModelAdmin):
    list_display = ("session", "crystal_id", "updated_at", "server_version")
    raw_id_fields = ("session",)


@admin.register(models.Conflict)
class ConflictAdmin(SyncedModelAdmin):
    list_display = ("table", "field", "record_id", "resolved", "created_at", "server_version")
    list_filter = ("resolved", "table")
