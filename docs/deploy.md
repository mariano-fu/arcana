# Tailscale setup (T4.2)

How the homelab stack is put on the tailnet and in her hands. The stack itself (compose,
`.env`, admin, smoke test): `deploy/README.md`. Design: `specs/plan.md`, "Deploy" and
"Security".

The chain is: her iPhone → `tailscale serve` on the homelab (TLS with the ts.net certificate,
port 443) → Caddy on `127.0.0.1:8080` → gunicorn. `tailscale serve` sets `X-Forwarded-For` to
the device's tailnet address. Caddy trusts only the gateway of the compose `edge` network
(`EDGE_GATEWAY`, default `172.30.80.1` on `172.30.80.0/24`), which is where Docker's loopback
publish connects from. The rate limit on login is keyed on the device's address.

Placeholders in this document: `<host>.<tailnet>.ts.net` is the node's MagicDNS name,
`<node-100.x>` its tailnet IPv4 address (`tailscale ip -4` on the homelab), `<her-account>` her
Tailscale login. Never commit the real values: the repo is public, and CI fails on a real
ts.net name (`.github/scripts/check-hostnames.sh`).

## Two rules

1. **The origin never changes.** The app's origin is exactly `https://<host>.<tailnet>.ts.net`:
   same host, port 443, root path. Her data lives in IndexedDB on her iPhone, which belongs to
   that origin. Any other host name, port or path prefix gives her an empty app, and her
   existing data is stranded under the old origin. Don't rename the node, don't serve the app
   on another port or under a path, and don't turn on Funnel. A rollback restores the exact
   previous config too (see Rollback).
2. **Migrations go out with or before the web app.** A new client schema (say, a new Dexie
   table) needs its server table first. Bring up `api` (which waits for `migrate`) and confirm
   it's healthy before starting the new `caddy`, which carries the PWA.

## 0. Before you start

On the homelab, in `deploy/`:

1. **A backup of her data.** On her iPhone: Ajustes → Respaldo → Exportar respaldo. Keep the
   `arcana-respaldo-<date>.json` file off the phone.
2. **Save the current `tailscale serve` config**, the one the rollback restores:

   ```sh
   tailscale serve status --json > ~/serve-before.json
   tailscale serve status        > ~/serve-before.txt   # the same, readable
   ```

   Check that the readable form shows `https://<host>.<tailnet>.ts.net` (the origin she uses
   today). Also decide how you'd restore it (see Rollback) and read `tailscale serve --help`
   for your version **now**, not halfway through a rollback.
3. **Free subnet for the edge network.** Compose creates `arcana_edge` on `172.30.80.0/24`. Make
   sure nothing on the homelab already uses that range:

   ```sh
   docker network inspect $(docker network ls -q) \
     --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
   ip route
   ```

   If anything overlaps `172.30.80.0/24`, choose a free `/24` and set both `EDGE_SUBNET` and
   `EDGE_GATEWAY` (the subnet's `.1`) in `deploy/.env`.
4. **Docker's userland proxy.** Note whether it's on (the default):

   ```sh
   grep userland-proxy /etc/docker/daemon.json   # nothing, or "true": on
   pgrep -a docker-proxy                         # on: one process per published port
   ```

   Either way, step 4's log check is what decides. This only tells you what to look into if
   that check fails.

## 1. Tailnet settings

In the Tailscale admin console:

1. DNS → turn on **MagicDNS**.
2. DNS → turn on **HTTPS Certificates**.
3. Machines → the homelab node: check the name is the `<host>` in her current origin, and turn
   off key expiry for it. Don't rename it: the name is part of the origin.

## 2. The stack, migrations first

The first `up` with this version creates the edge network with a fixed subnet. Compose won't
change an existing network's subnet in place, so the live stack comes down first. Use plain
`down`, **never `down -v`** (the database is in the external `arcana_pgdata` volume anyway,
which `down -v` can't remove).

```sh
cd deploy
git pull
export BUILD_COMMIT=$(git rev-parse --short=7 HEAD)
docker volume ls                         # note what's there
docker compose build
docker compose down                      # NEVER -v
docker compose up -d --wait api cron     # db → migrate → api, cron; fails if migrate fails
docker compose up -d --wait caddy        # only now the new PWA
docker volume ls                         # same list; arcana_pgdata still there
```

If the `api` step fails, stop there. Read `docker compose logs migrate api`, and don't start
`caddy` with a client the server can't serve yet.

Check that the edge network has the expected gateway and Caddy trusts that address:

```sh
docker network inspect arcana_edge \
  --format '{{range .IPAM.Config}}{{.Subnet}} gateway {{.Gateway}}{{end}}'
#  → 172.30.80.0/24 gateway 172.30.80.1   (or your EDGE_SUBNET / EDGE_GATEWAY)
docker compose exec caddy printenv EDGE_GATEWAY
#  → the same gateway
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/healthz   # → 200
```

From now on, updates follow the same order: `docker compose build`, then
`up -d --wait api cron`, then `up -d --wait caddy` (`deploy/README.md`, "Updating"). Only
this first time needs the `down`.

## 3. tailscale serve → Caddy

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

The status must show exactly this and nothing else for the app:

```
https://<host>.<tailnet>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8080
```

In particular: port 443 (no `:8443` or other port in the URL), path `/` (no `--set-path`),
`tailnet only` (no Funnel). If anything differs, fix it before going on, or roll back.

## 4. Her data, before anything else

On her iPhone, with Tailscale connected, open the installed app from the home screen. **Before
logging in, syncing or changing anything**, check that her clients, sessions and payments are
there as she left them.

- **Data there:** carry on.
- **Data missing:** stop. Don't clear anything, don't reinstall the app, don't import the
  backup yet. Missing data means the origin changed, and the data is still on the phone under
  the old origin. Roll back (below) and her data comes back. Then work out what differed (host,
  port or path) before trying again.

## 5. The proxy chain on the real node

CI's smoke test checks Caddy's side with simulated headers. Only the real node shows what
`tailscale serve` and Docker actually send. **If any check here fails, stop: don't let her use
the app until the chain is fixed.** Otherwise every device can end up in one rate-limit bucket
(her phone locked out by another device's failed logins), or a device can choose its own
address.

Run each check from a tailnet device (your laptop), then read Caddy's access log on the homelab:

```sh
caddy_log() {
  docker compose logs --no-log-prefix caddy |
    jq -rR 'fromjson? | select(.msg == "handled request")
            | [.request.client_ip, .request.remote_ip, .request.uri] | @tsv' | tail -5
}
```

1. **client_ip is the device.**

   ```sh
   # laptop
   curl -s -o /dev/null https://<host>.<tailnet>.ts.net/healthz?probe=device
   # homelab
   caddy_log
   ```

   For the `probe=device` line:
   - `client_ip` (first column) must be the laptop's tailnet address (`tailscale ip -4` on the
     laptop, a `100.x` address);
   - `remote_ip` (second column) must be the edge gateway (`172.30.80.1`);
   - `client_ip` must **never** be the gateway itself.

   If `client_ip` is the gateway: either `tailscale serve` didn't set `X-Forwarded-For`, or
   Docker connects from a different address than the gateway. In the second case `remote_ip` is
   that other address. This can happen when the userland proxy is off (step 0.4), where the
   loopback publish is NATed instead of proxied. Stop. Don't widen `trusted_proxies` to make it
   pass. Find out where that address comes from and fix the chain in a PR, with smoke.sh
   updated to match.

2. **A spoofed X-Forwarded-For changes nothing.**

   ```sh
   # laptop
   curl -s -o /dev/null -H 'X-Forwarded-For: 198.51.100.7' \
     https://<host>.<tailnet>.ts.net/healthz?probe=spoof
   # homelab
   caddy_log
   ```

   `client_ip` on the `probe=spoof` line must still be the laptop's `100.x` address, never
   `198.51.100.7` and never the gateway.

3. **A second device isn't throttled by the first.** Login is limited to `AUTH_THROTTLE_RATE`
   (10/min) per gunicorn worker (2), so about 20 a minute per device. From the laptop, about 25
   bad login attempts, one after another:

   ```sh
   for i in $(seq 25); do
     curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
       -d '{}' https://<host>.<tailnet>.ts.net/api/auth/token/
   done | sort | uniq -c
   ```

   The laptop must reach `429`. Within the same minute, from a **second** device (your phone,
   say): one bad login in the app, or the same `curl` once, must get a normal "wrong
   credentials" answer (`400`), not `429`. If the second device gets `429` too, every device is
   in one bucket: stop (see check 1). The laptop's block clears after a minute.

## 6. Share the node with her, limited to the app

> **Unverified: test it with the policy's `tests` block and by hand from her device.**
> Sharing combined with ACLs hasn't been tried on this tailnet yet.

1. Admin console → Machines → the homelab node → Share. Send the invite to her. She accepts it
   with `<her-account>` in the Tailscale app on her iPhone. She sees only this node, not the
   rest of the tailnet.
2. Access controls: limit her to port 443 on the node (the `tailscale serve` port, i.e. the
   app). If the policy is still the default allow-all (`"src": ["*"], "dst": ["*:*"]`), replace
   that rule. `*` includes shared-in users, so leaving it would give her every port. If you
   already have your own rules, merge these in.

   ```jsonc
   {
     "hosts": {
       "arcana": "<node-100.x>",
     },
     "acls": [
       // Your own devices (tailnet members): as before. The Django admin goes over an SSH tunnel
       // from these only (deploy/README.md, "Admin").
       {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
       // Her account, on the shared node: the app and nothing else.
       {"action": "accept", "src": ["<her-account>"], "dst": ["arcana:443"]},
     ],
     "tests": [
       {
         "src": "<her-account>",
         "accept": ["arcana:443"],
         "deny": ["arcana:22", "arcana:80", "arcana:8080", "arcana:8001"],
       },
     ],
   }
   ```

   Saving runs the `tests`. If the editor rejects the test because `<her-account>` is a
   shared-in user and not a member, keep the rule, drop the test, and rely on the manual check.
   Try `autogroup:shared` as the rule's `src` if her login doesn't match.
3. **Manual check from her device** (iPhone, Tailscale connected): the app opens and syncs.
   With a network tool on her phone, or from a test account that shares the node the same way,
   `https://<host>.<tailnet>.ts.net` answers and port 22 on `<node-100.x>` doesn't.

## 7. Installing on her iPhone

Only for a first install or a new phone. An already installed app keeps working (step 4).

1. Tailscale connected on the iPhone.
2. Open **Safari** itself (not a link inside WhatsApp or Instagram) at
   `https://<host>.<tailnet>.ts.net`. Exactly this URL: no port, no path.
3. Compartir → Agregar a inicio. Open it from the home screen and log in.
4. After that the app opens and works offline with Tailscale off. Sync and app updates need
   Tailscale on. iOS allows one VPN at a time: with another VPN on, sync waits until Tailscale
   is back.

## Rollback

The goal is to put back **exactly** the previous `tailscale serve` config, so the origin is the
same during a rollback too.

```sh
tailscale serve reset
# Restore ~/serve-before.json: if your version has a raw setter (`tailscale serve --help`;
# for example `tailscale serve set-raw < ~/serve-before.json`), use it; otherwise re-run the
# serve commands that produce what ~/serve-before.txt shows.
diff <(tailscale serve status --json) ~/serve-before.json && echo "serve config restored"
```

The `diff` must show no differences. If it does, fix the config until it doesn't: a near match
can be a different origin. Then check her data on her iPhone as in step 4.

Rolling the stack itself back to an older commit is a separate decision, and usually not
needed. Migrations aren't reversed, and an older server under a newer PWA already on her phone
is exactly what rule 2 avoids. If you do it, use the step 2 sequence (`down`, never `-v`;
`up -d --wait api cron`; then `caddy`).
