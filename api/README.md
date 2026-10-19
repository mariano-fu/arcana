# api

Django 5.2 + DRF sync server (see `specs/plan.md`, Backend). Python 3.13, managed with [uv](https://docs.astral.sh/uv/).

## Local setup

```sh
cd api
uv sync
cp .env.example .env   # DEBUG=true locally; set SECRET_KEY for anything else
docker run -d --rm --name arcana-pg -p 5432:5432 \
  -e POSTGRES_USER=arcana -e POSTGRES_PASSWORD=arcana -e POSTGRES_DB=arcana \
  postgres:16-alpine
uv run python manage.py migrate
uv run python manage.py runserver
```

`GET /api/health/` is the only endpoint that works without auth.

## Checks

```sh
uv run ruff check . && uv run ruff format --check .
uv run mypy .
uv run pytest            # needs Postgres; there is no SQLite fallback
```

## Docker

```sh
docker build -t arcana-api .
```

The image runs gunicorn on port 8000 as a non-root user and serves the admin's static files with WhiteNoise. It needs `SECRET_KEY`, `DATABASE_URL` and `ALLOWED_HOSTS` (see `.env.example`). Run migrations with `docker exec <container> python manage.py migrate`. Compose wiring belongs to `deploy/` (T4.1).
