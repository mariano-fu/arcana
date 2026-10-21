"""Django settings. Every deployment-specific value comes from the environment.

Locally, values can also come from `api/.env` (see `.env.example`); real environment
variables take precedence over the file.
"""

from datetime import timedelta
from pathlib import Path

import django_stubs_ext
import environ
from django.core.exceptions import ImproperlyConfigured

# Lets generic Django classes (e.g. `ModelAdmin[Client]`) be subscripted at runtime for mypy.
django_stubs_ext.monkeypatch()

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

DEBUG: bool = env.bool("DEBUG", default=False)

SECRET_KEY: str = env.str("SECRET_KEY", default="")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("SECRET_KEY must be set when DEBUG is off.")
    SECRET_KEY = "insecure-dev-only-key-not-for-production"  # noqa: S105 - only reachable with DEBUG on

ALLOWED_HOSTS: list[str] = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS: list[str] = env.list("CSRF_TRUSTED_ORIGINS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core",
    "sync",
    "horoscopes",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "arcana.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "arcana.wsgi.application"

# PostgreSQL only, also in tests: no SQLite fallback, so behavior never diverges.
DATABASES = {
    "default": env.db_url("DATABASE_URL", default="postgres://arcana:arcana@localhost:5432/arcana"),
}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# The admin is for Mariano only; API field names and code are English (constitution §3).
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# A sync push holds up to 500 full rows (notes, spread snapshots); the default 2.5 MB is tight.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# HTTPS is terminated by `tailscale serve` and Caddy in front of gunicorn.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

REST_FRAMEWORK = {
    # Auth on every endpoint except the health check (constitution §2). JWT only: the PWA keeps
    # its tokens in IndexedDB, so the API needs no session cookies (and no CSRF surface).
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # Scoped per view (core/auth.py). Clients are told apart by REMOTE_ADDR (NUM_PROXIES unset),
    # which behind Caddy is the proxy: one shared bucket per scope, fine for a single-user app
    # and not dodgeable via X-Forwarded-For. Counts live in each worker's local-memory cache,
    # so the effective limit is the rate times the number of gunicorn workers.
    "DEFAULT_THROTTLE_RATES": {"auth": env.str("AUTH_THROTTLE_RATE", default="10/min")},
}

# OpenAPI schema (`api/openapi.yaml`, served at /api/schema/); the web client's TS types are
# generated from it (`npm run gen:api-types`).
SPECTACULAR_SETTINGS = {
    "TITLE": "Arcana API",
    "DESCRIPTION": "Sync and backup server for the Arcana tarot practice app.",
    "VERSION": "0.1.0",
    # Request and response records differ (`server_version` is response-only).
    "COMPONENT_SPLIT_REQUEST": True,
    "SERVE_INCLUDE_SCHEMA": False,
    # Spectacular serves the schema to anyone by default; auth everywhere (constitution §2).
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
    "ENUM_NAME_OVERRIDES": {
        "CurrencyEnum": "sync.models.Currency",
        "SessionTypeEnum": "sync.models.SessionType",
        "PaymentMethodEnum": "sync.models.PaymentMethod",
        "SyncedTableEnum": "sync.models.SYNCED_TABLE_NAMES",
        "RecordErrorCodeEnum": "sync.service.ERROR_CODES",
    },
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "sync.schema.postprocess",
    ],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    # Each refresh returns a new refresh token and blacklists the old one.
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

# Containers log to stdout/stderr; Docker collects it.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env.str("LOG_LEVEL", default="INFO")},
}
