from django.contrib import admin

from horoscopes.models import Horoscope
from sync.admin import SyncedModelAdmin


@admin.register(Horoscope)
class HoroscopeAdmin(SyncedModelAdmin):
    """Also the manual fallback source: she or Mariano can paste a text here (plan.md)."""

    list_display = ("date", "sign", "source", "translator", "server_version")
    list_filter = ("sign", "source", "translator")
    search_fields = ("text_en", "text_es")
    date_hierarchy = "date"
