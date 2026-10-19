FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project --no-cache
COPY . .
# collectstatic imports settings, which need a SECRET_KEY; this one never leaves the build stage.
RUN SECRET_KEY=collectstatic-only DATABASE_URL=postgres://unused@localhost/unused \
    /opt/venv/bin/python manage.py collectstatic --noinput

FROM python:3.13-slim
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 --create-home arcana
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=arcana:arcana /app /app
USER arcana
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=4).status != 200)"]
CMD ["gunicorn", "arcana.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "-"]
