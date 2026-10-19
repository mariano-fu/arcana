from typing import Any

import pytest
from django.contrib import admin
from django.test import Client
from django.urls import reverse

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
