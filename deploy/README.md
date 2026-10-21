# Deploy

The homelab stack: `caddy` (the built PWA and `/api`), `api` (gunicorn), `db` (Postgres), `cron`
(supercronic) and a one-shot `migrate`. Design and limits: `specs/plan.md`, "Deploy". Tailscale
setup: `docs/deploy.md` (T4.2).

Needs Docker Engine with the Compose and **buildx** plugins (the Caddy image uses a named build
context).

## First time

```sh
cd deploy
docker volume create arcana_pgdata      # the database; outside the project, so `down -v` can't remove it
cp .env.example .env                     # fill in; .env is gitignored, never commit it
BUILD_COMMIT=$(git rev-parse --short=7 HEAD) docker compose up -d --build
docker compose exec api python manage.py createsuperuser
```

Then point `tailscale serve` on the host at `http://127.0.0.1:8080` (`CADDY_PORT`).

## Updating

```sh
git pull && BUILD_COMMIT=$(git rev-parse --short=7 HEAD) docker compose up -d --build
```

`BUILD_COMMIT` is the commit Ajustes → Versiones shows; without it, it shows "dev".

Every `up` runs `migrate` first; `api` and `cron` start only once it has succeeded.

## Admin

The Django admin is not reachable through Caddy, and by default nothing else on the host
listens: the api has no published port. For an admin session, start the opt-in `admin` service
(a second api process on the host's loopback, `ADMIN_PORT`, default 8001), tunnel to it from a
laptop, open http://localhost:8001/admin/, and stop it when done. Requests to it bypass Caddy's
body limit and the proxy chain the throttling relies on, so don't leave it running.

```sh
docker compose --profile admin up -d admin       # on the homelab
ssh -L 8001:127.0.0.1:8001 <user>@<homelab-host>  # from the laptop
docker compose --profile admin rm -sf admin       # when done
```

For one-off commands: `docker compose exec api python manage.py <command>`.

## Smoke test

`deploy/smoke.sh` builds and starts the stack under its own project name, ports and volume,
checks it (caching headers, SPA fallback, throttling behind both proxies, cron, non-root, the
external volume), then removes what it created. It never reads `deploy/.env` or touches
`arcana_pgdata`. CI runs it in the `deploy` job.
