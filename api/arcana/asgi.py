"""ASGI entry point (unused for now; gunicorn serves WSGI)."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "arcana.settings")

application = get_asgi_application()
