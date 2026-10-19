from typing import Any

import pytest
from django.contrib import admin
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from sync.models import SERVER_DEVICE_ID
from sync.registry import synced_models
from tests import factories

pytestmark = pytest.mark.django_db

FACTORIES: dict[str, type[Any]] = {
    "client": factories.ClientFactory,
    "session": factories.SessionFactory,
    "payment": factories.PaymentFactory,
    "reading": factories.ReadingFactory,
    "card_draw": factories.CardDrawFactory,
    "spread_template": factories.SpreadTemplateFactory,
    "crystal": factories.CrystalFactory,
    "intention_tag": factories.IntentionTagFactory,
    "card_note": factories.CardNoteFactory,
    "conflict": factories.ConflictFactory,
    "horoscope": factories.HoroscopeFactory,
}


def test_every_synced_model_is_registered() -> None:
    assert set(FACTORIES) == set(synced_models())
    for model in synced_models().values():
        assert admin.site.is_registered(model)


@pytest.mark.parametrize("table", sorted(FACTORIES))
def test_admin_pages_load(admin_client: Client, table: str) -> None:
    row = FACTORIES[table]()
    meta = row._meta
    prefix = f"admin:{meta.app_label}_{meta.model_name}"

    for url in (
        reverse(f"{prefix}_changelist"),
        reverse(f"{prefix}_add"),
        reverse(f"{prefix}_change", args=[row.pk]),
    ):
        response = admin_client.get(url)
        assert response.status_code == 200, url


def test_admin_requires_login(client: Client) -> None:
    response = client.get(reverse("admin:sync_client_changelist"))

    assert response.status_code == 302


def test_admin_cannot_hard_delete(admin_client: Client) -> None:
    row = factories.ClientFactory()

    response = admin_client.get(reverse("admin:sync_client_delete", args=[row.pk]))

    assert response.status_code == 403
    assert synced_models()["client"].objects.filter(pk=row.pk).exists()


def test_admin_tombstone_action_marks_rows_deleted(admin_client: Client) -> None:
    live, gone = factories.ClientFactory(), factories.ClientFactory(deleted_at=timezone.now())
    gone_version = gone.server_version

    response = admin_client.post(
        reverse("admin:sync_client_changelist"),
        {"action": "tombstone", "_selected_action": [str(live.pk), str(gone.pk)]},
    )

    assert response.status_code == 302
    live.refresh_from_db()
    gone.refresh_from_db()
    assert live.deleted_at is not None
    assert live.device_id == SERVER_DEVICE_ID
    assert gone.server_version == gone_version  # Already a tombstone: left alone.
