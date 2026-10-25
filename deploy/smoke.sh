#!/usr/bin/env bash
# Smoke test of the deployed stack (T4.1): builds and starts it under a separate project name,
# ports and volume, checks it from the host the way tailscale serve reaches it, then removes
# everything it created. Never touches deploy/.env or the real database volume.
#
#   deploy/smoke.sh            # from anywhere; needs docker compose, curl, python3
set -euo pipefail

cd "$(dirname "$0")"
PROJECT=arcana-smoke
export PGDATA_VOLUME=arcana_smoke_pgdata
export CADDY_PORT=18080 ADMIN_PORT=18001
BASE="http://127.0.0.1:${CADDY_PORT}"
WORK=$(mktemp -d)
export ENV_FILE="$WORK/smoke.env"
THROTTLE_LIMIT=3

cat >"$ENV_FILE" <<EOF
SECRET_KEY=smoke-only-$(python3 -c 'import secrets; print(secrets.token_hex(24))')
POSTGRES_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
ALLOWED_HOSTS=app.example.test,localhost
CSRF_TRUSTED_ORIGINS=https://app.example.test
NUM_PROXIES=2
AUTH_THROTTLE_RATE=${THROTTLE_LIMIT}/min
# One gunicorn worker: each worker keeps its own throttle counts, so with more the checks
# below would depend on which worker a request lands on.
WEB_CONCURRENCY=1
EOF
# The edge network (docker-compose.yml): its own subnet, so a run next to the live stack doesn't
# clash with it.
export EDGE_SUBNET=172.30.81.0/24 EDGE_GATEWAY=172.30.81.1

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"; }
# Every profile, so cleanup also removes the opt-in admin service.
compose_all() { compose --profile admin "$@"; }

cleanup() {
	status=$?
	if [ "$status" -ne 0 ]; then compose logs --no-color --tail 80 || true; fi
	compose_all down -v --remove-orphans >/dev/null 2>&1 || true
	docker volume rm "$PGDATA_VOLUME" >/dev/null 2>&1 || true
	rm -rf "$WORK"
	exit "$status"
}
trap cleanup EXIT

failures=0
check() { # description, then a command that must succeed
	local what=$1
	shift
	if "$@"; then echo "ok   $what"; else
		echo "FAIL $what"
		failures=$((failures + 1))
	fi
}

# As tailscale serve sends it: the device's tailnet address (RFC 6598 example) and https.
as_device() { curl -s -H "Host: app.example.test" -H "X-Forwarded-For: $1" -H "X-Forwarded-Proto: https" "${@:2}"; }
header() { # name, path, extra curl args: prints that response header's value
	local name=$1 path=$2
	shift 2
	curl -s -o /dev/null -D - "$@" "$BASE$path" | tr -d '\r' | grep -i "^$name:" | head -1 | cut -d' ' -f2-
}
API_HOST=(-H "Host: app.example.test")
status_of() { curl -s -o /dev/null -w '%{http_code}' "${@:2}" "$1"; }

# The commit the PWA is built with (Ajustes → Versiones): CI's, else this checkout's.
COMMIT=$(printf '%s' "${GITHUB_SHA:-$(git rev-parse HEAD)}" | cut -c1-7)
export BUILD_COMMIT=$COMMIT

docker volume create "$PGDATA_VOLUME" >/dev/null
compose up -d --build --wait

echo "== volume and migrations"
external() { compose config --format json | python3 -c 'import json,sys; v=json.load(sys.stdin)["volumes"]["pgdata"]; sys.exit(not v.get("external"))'; }
check "database volume is external" external
check "migrate --check: nothing pending" compose run --rm --no-deps migrate python manage.py migrate --check
blacklist_applied() { ! compose run --rm --no-deps migrate python manage.py showmigrations token_blacklist | grep -q '\[ \]'; }
check "simplejwt token_blacklist migrations applied" blacklist_applied

echo "== static files and caching"
check "health through Caddy" test "$(status_of "$BASE/api/health/" "${API_HOST[@]}")" = 200
check "manifest is application/manifest+json" test "$(header content-type /manifest.webmanifest)" = "application/manifest+json"
for path in / /index.html /sw.js /registerSW.js; do
	check "$path is no-cache" test "$(header cache-control "$path")" = "no-cache"
done
asset=$(curl -s "$BASE/" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
check "found a hashed asset in index.html ($asset)" test -n "$asset"
check "hashed asset is immutable" test "$(header cache-control "$asset")" = "public, max-age=31536000, immutable"
# The minifier may quote it with ", ' or a backtick.
commit_built_in() { compose exec -T caddy grep -rlqE "[\"'\`]$COMMIT[\"'\`]" /srv/assets; }
check "the PWA is built with commit $COMMIT, not \"dev\"" commit_built_in
check "hashed JS is compressed" test -n "$(header content-encoding "$asset" -H 'Accept-Encoding: zstd, gzip')"
spa_root() { test "$(status_of "$BASE/")" = 200 && curl -s "$BASE/" | grep -q '<div id="root">'; }
spa() { test "$(status_of "$BASE/clients/123")" = 200 && curl -s "$BASE/clients/123" | grep -q '<div id="root">'; }
check "SPA route gets the app shell" spa
check "missing hashed asset is 404" test "$(status_of "$BASE/assets/missing-0000.js")" = 404
check "missing workbox file is 404" test "$(status_of "$BASE/workbox-00000000.js")" = 404
not_shell() { ! curl -s "$BASE/api/nope/" "${API_HOST[@]}" | grep -q '<div id="root">'; }
check "unknown /api path is a 404 from Django" test "$(status_of "$BASE/api/nope/" "${API_HOST[@]}")" = 404
check "  …and not the app shell" not_shell
check "/api responses are no-store" test "$(header cache-control /api/health/ "${API_HOST[@]}")" = "no-store"

echo "== admin"
ADMIN_URL="http://127.0.0.1:${ADMIN_PORT}/admin/"
check "admin is not proxied by Caddy" test "$(status_of "$BASE/admin/")" = 404
# 000: no connection. By default nothing on the host bypasses Caddy.
check "by default nothing listens on ADMIN_PORT" test "$(status_of "$ADMIN_URL")" = 000
compose --profile admin up -d --wait admin
check "the admin profile answers on the loopback tunnel port" test "$(status_of "$ADMIN_URL" -H 'Host: localhost')" = 302
compose --profile admin rm -sf admin >/dev/null 2>&1
check "  …and stops listening once stopped" test "$(status_of "$ADMIN_URL")" = 000

echo "== throttling keys on the device behind both proxies"
last=""
for _ in $(seq $((THROTTLE_LIMIT + 1))); do
	last=$(as_device 100.64.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/token/")
done
check "device A is throttled (429)" test "$last" = 429
check "device B is not (400)" test "$(as_device 100.64.0.2 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/token/")" = 400
spoofed=$(as_device "198.51.100.7, 100.64.0.1" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/token/")
check "a client-sent X-Forwarded-For doesn't escape device A's bucket" test "$spoofed" = 429

echo "== Caddy trusts only the edge gateway as a proxy"
# client_ip in Caddy's access log for the request whose URI carries the marker $1.
client_ip() {
	for _ in $(seq 20); do
		ip=$(compose logs --no-color --no-log-prefix caddy | python3 -c '
import json, sys
for line in sys.stdin:
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if not isinstance(entry, dict) or entry.get("msg") != "handled request":
        continue
    request = entry.get("request") or {}
    if sys.argv[1] in request.get("uri", ""):
        print(request.get("client_ip", ""))
' "$1" | tail -1)
		if [ -n "$ip" ]; then
			echo "$ip"
			return
		fi
		sleep 0.5
	done
}
# Through the loopback publish, as tailscale serve reaches it.
as_device 100.64.0.1 -o /dev/null "$BASE/healthz?probe=xff-device"
via_publish=$(client_ip probe=xff-device)
check "client_ip is the device behind tailscale serve ($via_publish)" test "$via_publish" = 100.64.0.1
check "  …never the edge gateway itself" test "$via_publish" != "$EDGE_GATEWAY"
as_device "198.51.100.7, 100.64.0.1" -o /dev/null "$BASE/healthz?probe=xff-spoofed"
spoofed_ip=$(client_ip probe=xff-spoofed)
check "a client-sent X-Forwarded-For doesn't change client_ip ($spoofed_ip)" test "$spoofed_ip" = 100.64.0.1
check "  …nor makes it the edge gateway" test "$spoofed_ip" != "$EDGE_GATEWAY"
# Any other peer on the edge network is not a proxy: Caddy ignores its X-Forwarded-For. This
# is what trusting private_ranges got wrong. A throwaway container from the api image (no
# curl needed), removed when it exits.
peer=$(docker run --rm --network "${PROJECT}_edge" --read-only --cap-drop ALL \
	--security-opt no-new-privileges:true arcana-api:local python -c '
import http.client
c = http.client.HTTPConnection("caddy", 8080, timeout=10)
c.request("GET", "/healthz?probe=edge-peer", headers={"X-Forwarded-For": "100.64.0.9"})
c.getresponse().read()
print(c.sock.getsockname()[0])
' || true)
peer_ip=$(client_ip probe=edge-peer)
check "a container on the edge network reached Caddy ($peer)" test -n "$peer"
check "  …and its X-Forwarded-For is ignored: client_ip is the peer ($peer_ip)" test -n "$peer" -a "$peer_ip" = "$peer"

echo "== cron"
check "crontab parses" compose exec -T cron supercronic -test /app/crontab
check "flushexpiredtokens runs" compose exec -T cron python manage.py flushexpiredtokens

echo "== non-root"
for service in api cron caddy; do
	check "$service runs as non-root" test "$(compose exec -T "$service" id -u)" != 0
done

echo "== Caddy without the API"
# As after a failed migration: api never starts. Caddy must start anyway and serve the shell.
compose rm -sf api caddy >/dev/null 2>&1
compose up -d --wait caddy >/dev/null 2>&1
check "caddy starts on its own, without pulling in api" test -z "$(compose ps -q api)"
check "with no api, / still serves the app shell" spa_root
check "  …and /api/health/ is 502" test "$(status_of "$BASE/api/health/" "${API_HOST[@]}")" = 502

echo "== the database volume survives down -v"
compose_all down -v --remove-orphans >/dev/null 2>&1
volume_exists() { docker volume inspect "$PGDATA_VOLUME" >/dev/null 2>&1; }
check "volume still exists after down -v" volume_exists

if [ "$failures" -ne 0 ]; then
	echo "$failures check(s) failed"
	exit 1
fi
echo "all checks passed"
