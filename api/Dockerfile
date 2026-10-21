# Base images are pinned by tag and digest; bump both together.
FROM python:3.13.16-slim@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.3@sha256:2d890623d310b57771ce840f0da5eed5fc6d657da05ffaa45d82797b53fa3abc /uv /usr/local/bin/uv
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

FROM python:3.13.16-slim@sha256:98ce6fb13b3803744fbca11434f00818f1e300e4e48a4f204e07b2c928b6218e AS base
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 --create-home arcana
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=arcana:arcana /app /app
USER arcana

# Scheduled jobs (deploy/crontab), run by supercronic: non-root, logs to stdout.
FROM base AS cron
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.50
# SHA-256 of the release binaries, computed from downloads that matched the release's SHA1SUMs.
ARG SUPERCRONIC_SHA256_AMD64=d2d7c97fbfefc763d5bbcbbb3f8d61f9dd3410ce5d05a737c414994b80b8cdd0
ARG SUPERCRONIC_SHA256_ARM64=a1c0af9872e8de89a1ce5c1b596e26c42917d5a2cf914d98faee2e28156899e2
USER root
RUN python - <<'EOF'
import hashlib, os, urllib.request
arch = os.environ["TARGETARCH"]
expected = {"amd64": os.environ["SUPERCRONIC_SHA256_AMD64"],
            "arm64": os.environ["SUPERCRONIC_SHA256_ARM64"]}[arch]
url = ("https://github.com/aptible/supercronic/releases/download/"
       f"{os.environ['SUPERCRONIC_VERSION']}/supercronic-linux-{arch}")
data = urllib.request.urlopen(url, timeout=60).read()
actual = hashlib.sha256(data).hexdigest()
if actual != expected:
    raise SystemExit(f"supercronic checksum mismatch: {actual} != {expected}")
with open("/usr/local/bin/supercronic", "wb") as f:
    f.write(data)
os.chmod("/usr/local/bin/supercronic", 0o755)
EOF
USER arcana
CMD ["supercronic", "-passthrough-logs", "/app/crontab"]

# The API (the default target).
FROM base AS runtime
EXPOSE 8000
# Host: localhost, which ALLOWED_HOSTS must keep (Django refuses 127.0.0.1:8000 otherwise).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u,sys; r=u.Request('http://127.0.0.1:8000/api/health/', headers={'Host': 'localhost'}); sys.exit(u.urlopen(r, timeout=4).status != 200)"]
# --timeout: a sync worker handling one request longer than this is restarted. Caddy buffers
# request bodies (deploy/caddy/Caddyfile), so a slow phone upload never holds a worker.
# --worker-tmp-dir and --no-control-socket: nothing is written to disk, so the root filesystem
# can be read-only. Workers: WEB_CONCURRENCY (gunicorn's default when --workers isn't given).
ENV WEB_CONCURRENCY=2
CMD ["gunicorn", "arcana.wsgi:application", "--bind", "0.0.0.0:8000", \
     "--timeout", "60", "--graceful-timeout", "30", "--worker-tmp-dir", "/dev/shm", \
     "--no-control-socket", "--access-logfile", "-"]
