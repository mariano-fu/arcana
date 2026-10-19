from collections.abc import Iterator

import pytest
from django.conf import settings
from django.test import override_settings


@pytest.fixture(autouse=True)
def plain_static_storage() -> Iterator[None]:
    # The manifest storage needs `collectstatic`; tests render admin pages without it.
    storages = {
        **settings.STORAGES,
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    with override_settings(STORAGES=storages):
        yield
