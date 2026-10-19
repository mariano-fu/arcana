# Plan — Technical design

## Architecture at a glance

```
 iPhone (installed PWA)          Laptop (browser / installed PWA)
 ┌──────────────────────┐        ┌──────────────────────┐
 │ React + TS UI        │        │ same app             │
 │ Dexie (IndexedDB)  ◄─┼─ UI reads/writes local only    │
 │ Sync engine          │        │                      │
 │ Service worker cache │        │                      │
 └─────────┬────────────┘        └──────────┬───────────┘
           │ HTTPS, when online (push/pull)  │
           ▼                                 ▼
 ┌──────────────────────────────────────────────────────┐
 │ Homelab (Docker Compose)                             │
 │ Caddy ─ serves PWA static files + proxies /api       │
 │ Django + DRF (gunicorn) ── PostgreSQL                │
 │ Scheduled job: daily horoscopes (provider adapters)  │
 └──────────────────────────────────────────────────────┘
   reachable only inside the tailnet via `tailscale serve`
   (https://<host>.<tailnet>.ts.net, no public exposure)
```

**Key decision:** the UI never calls the API directly for data. It only talks to IndexedDB. A separate sync engine reconciles IndexedDB with the server in the background. This is what makes offline "free" and is the main architecture story for the README.

## Frontend

| Concern | Choice | Why |
|---|---|---|
| Build | Vite + React 19 + TypeScript 6.0 (strict) | Target-job stack. TS pinned to 6.0: typescript-eslint doesn't support 7 yet. Don't upgrade until it does. |
| Routing | React Router | Standard |
| Local DB | Dexie.js + `dexie-react-hooks` (`useLiveQuery`) | Typed IndexedDB, reactive queries, good Safari support |
| Validation | Zod | Shared schemas for forms, import files, sync payloads |
| PWA | `vite-plugin-pwa` (Workbox, precache app shell + seed JSON) | Offline + installable on iOS |
| Styling | Tailwind CSS | Fast, consistent, mobile-first |
| i18n | i18next, `es` only for now | Principle 3 |
| Dates/TZ | Luxon | IANA timezones incl. historical DST for natal charts |
| Astrology math | `astronomy-engine` (MIT) for planet ecliptic longitudes; ascendant/MC/Placidus houses implemented in a small `astro/` module | Offline, permissive license. **Avoid Swiss Ephemeris bindings (AGPL)** in case this becomes a product |
| Tests | Vitest + Testing Library; Playwright e2e incl. WebKit + iPhone viewport | Catch Safari issues early |

TypeScript is pinned to `~6.0` until typescript-eslint supports 7.x (its peer range is `<6.1`).

### Folder layout
```
web/
  src/
    db/           # Dexie schema, migrations, repositories
    sync/         # sync engine (push/pull, conflict handling)
    astro/        # sun sign, natal chart, houses — pure functions, heavily tested
    features/     # clients/, sessions/, payments/, spreads/, crystals/, settings/
    seed/         # cards.es.json, spreads.json, crystals.es.json, zodiac.es.json, cities.json
      images/     # cards/thumb/*.webp, cards/full/*.webp, CREDITS.md
    i18n/         # i18next setup, locales/es.json
  scripts/        # build-card-images.ts, build-cities.ts (web/scripts/)
  e2e/            # Playwright specs (web/e2e/)
```

## Backend

| Concern | Choice |
|---|---|
| Framework | Django 5 + Django REST Framework |
| DB | PostgreSQL 16 |
| Auth | `djangorestframework-simplejwt` (access + refresh; refresh rotates) |
| API docs | `drf-spectacular` (OpenAPI at `/api/schema/`) |
| Scheduled jobs | Phase 4: management command run by a cron container. Stretch: Celery + Redis beat |
| Tests | pytest-django, factory_boy |
| Serving | gunicorn behind Caddy |
| Deploy | Docker Compose: `caddy`, `api`, `db`, `cron` (+ `redis`, `worker` if stretch) |
| Exposure | Tailscale only. `tailscale serve` on the homelab terminates HTTPS with an auto-provisioned cert for `https://<host>.<tailnet>.ts.net` and proxies to Caddy. PWA and `/api` share that origin → no CORS. Her iPhone and laptop run the Tailscale client (server node shared with her account, or she joins the tailnet). Nothing is reachable from the public internet |
| Backups | Nightly `pg_dump` to a second disk, 30-day retention |

## Data model

All synced tables share these columns:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (v7, generated on the client) | Lets devices create records offline without collisions |
| `updated_at` | timestamptz (client clock) | Used for last-write-wins |
| `deleted_at` | timestamptz null | Tombstone |
| `server_version` | bigint | Server-assigned from a global sequence on every write; pull cursor |
| `device_id` | UUID | Which device last wrote it (debugging, conflict UI) |

Local-only (IndexedDB, never sent to the server):
- `pending` (`0|1`, not boolean, because IndexedDB can't index booleans): 1 while a row has unsynced changes. The sync push reads `where('pending').equals(1)`, tombstones included.
- `meta` key/value table: `device_id` (UUIDv7 created on first run), later `seed_version` and the sync cursor.

Local conventions: field names stay snake_case so rows go to the sync API as-is; timestamps are ISO 8601 UTC strings (sort lexically, which last-write-wins relies on); `server_version` is null until first sync. Deletes are soft (`deleted_at` set, row re-stamped `pending`), and repository reads hide tombstones by default.

Tables:
- **client**: name, instagram, whatsapp, email, birth_date (date, null), birth_time (time, null), birth_place_label, birth_lat, birth_lng, birth_tz (IANA), notes, tags (text[]), archived (bool)
- **session**: client_id, started_at, type (`in_person|online|message`), price_minor (int, null — céntimos/cents), currency (`CRC|USD`, default `CRC`), notes, follow_up_note, follow_up_date
- **payment**: session_id, client_id (denormalized for fast per-client totals), amount_minor (int), currency (`CRC|USD`), method (`sinpe|cash|transfer|paypal|other`), paid_at (date), reference (text, null — e.g. SINPE receipt number), note. Session status (`paid|partial|pending|no_charge|overpaid`) is **derived**, never stored, so it can't drift out of sync; a `paymentStatus(session, payments)` pure function owns that logic and is unit-tested.
- **reading**: session_id, spread_template_id, label, created_at
- **card_draw**: reading_id, position_index, card_id (seed key, e.g. `major-00`, `cups-07`), reversed (bool), note
- **spread_template**: name, positions (JSON: `[{index, name, meaning}]`), is_seed, seed_key
- **crystal**: seed_key (null if user-created), name, colors, chakras, signs, intentions (tag keys), description, care, hidden, user_modified (bool). No inventory fields in v1. Future inventory goes in a separate `crystal_stock` table (crystal_id, quantity, cost_minor, price_minor, currency), so recommendations never depend on stock data.
- **intention_tag**: key, label
- **card_note**: card_id, note (her personal notes per card)
- **conflict**: table, record_id, field, losing_value, losing_device_id, created_at, resolved (bool)
- **horoscope** (server-owned, read-only on clients): date, sign, period (`day`), text_en, text_es, source, translator

Seed-only (bundled JSON, not synced, versioned): tarot cards, zodiac sign profiles, cities.

Tarot cards (`seed/cards.es.json`, schema in `seed/cards.ts`): key, arcana, number, suit, element, astrology (Golden Dawn), keywords, upright, reversed. Majors store their Spanish `name`. Minor names are not stored: they are built from the rank and suit labels in `es.json` (`cards.rank.*`, `cards.suit.*`, e.g. "Paje de Oros"), so renaming a suit or court rank is a one-line edit. Court ranks are numbered 11 Paje, 12 Caballero, 13 Reina, 14 Rey; the Ace is 1. Astrology (recorded in the seed's `astrology_system` field): attributions follow the Golden Dawn (Book T) system: decans for pips 2–10; courts use the "20° to 20°" ranges, with GD Knight → RWS Rey and GD Prince → RWS Caballero. ‘Elemento’ on the majors is the sign’s element for zodiac cards and ‘—’ for planet cards. The exceptions follow GD’s own elemental attributions: the three elemental trumps El Loco (Aire), El Colgado (Agua) and El Juicio (Fuego), and El Mundo (Saturno + Tierra). Uranus, Neptune and Pluto are deliberately left out (modern additions, not original GD). Meanings are gender-neutral toward the consultant (a test rejects common masculine-only words, with an allowlist). `docs/review/cards-es.md` is generated from the seed (`npm run build:cards-review`) for her review, and a test fails if it is stale.

### Card images
- Source: scans of the original 1909 Rider-Waite-Smith deck (Pamela Colman Smith artwork, public domain), e.g. the set on Wikimedia Commons. Record the exact source URL and license of each file in `web/src/seed/images/CREDITS.md`; never pull from modern commercial editions.
- Build script `scripts/build-card-images.ts` (sharp): resize to two sizes (thumb ~160 px wide, full ~600 px wide), convert to WebP, name by card key (`major-00.webp`, `cups-07.webp`). Commit outputs; target ≤ 5 MB total.
- Precached by the service worker so they work offline. Card seed entries reference images by key, not path.
- Reversed cards: same file, rotated with CSS (`transform: rotate(180deg)`).

### Seed vs. user edits (Principle 5)
On app start, compare bundled seed version with local `seed_version`. For crystals/spreads: insert new seed rows; update existing seed rows **only if `user_modified = false`**; never delete her rows.

## Sync protocol

Single endpoint, push-then-pull, idempotent.

```
POST /api/sync/
{
  "device_id": "…",
  "cursor": 1842,              // last server_version this device has seen
  "changes": [                 // local rows with pending=true
    { "table": "client", "record": { …full row… } }
  ]
}
→ 200
{
  "applied":   ["<id>", …],
  "conflicts": [{ "table": "client", "id": "…", "field": "notes" }],
  "changes":   [ { "table": …, "record": … } ],   // server_version > cursor, excluding rows this request just wrote
  "cursor":    1907
}
```

Server rules per incoming record:
1. If no existing row → insert, assign `server_version`.
2. If incoming `updated_at` > stored `updated_at` → overwrite. For free-text fields (`notes`, `follow_up_note`, `card_draw.note`, `card_note.note`, `payment.note`): if the stored value differs and was written by a different device since this device's cursor, store the losing value in `conflict`.
3. If incoming is older → reject that record, return the server's version in `changes`.
4. Tombstones follow the same rules; a delete wins over an older edit.

Client rules:
- Every local write sets `updated_at = now`, `pending = true`.
- Sync runs on app open, on `online` event, every 5 min while visible, and on demand. Single-flight (no overlapping syncs).
- Paginate pull at 500 records; loop until `cursor` stops advancing.
- Clock skew: on each sync the server returns its time. If device skew > 2 min, show a warning in Settings.

Tests must cover: concurrent edits on two devices, delete vs. edit, offline for a week then sync, notes conflict preserved, re-sending the same push twice (idempotent).

## Astrology module (`web/src/astro/`)

Pure functions, no UI:
- `sunSign(birthDate)` → handles cusp dates properly by computing the sun's actual longitude when time/place are known; date-only falls back to the standard date table and flags cusp days.
- `toUtc(date, time | null, ianaTz)` → Luxon; when time is null, use 12:00 local and mark result `timeKnown: false`.
- `planetPositions(utc)` → sun, moon, mercury … pluto ecliptic longitudes via astronomy-engine → sign + degree.
- `moonSignUncertain(date, tz)` → true if the moon changes sign during that local day.
- `ascendantAndHouses(utc, lat, lng)` → only when time known; Placidus (confirmed as her system), whole-sign as fallback near polar latitudes where Placidus is undefined.
- Zodiac: Western tropical (confirmed). No sidereal support needed.

Reference test set: 10+ charts with known positions (pick public charts and verify against a trusted online ephemeris). Tolerance 1°.

Cities: subset of GeoNames `cities15000` (CC BY 4.0 — credit GeoNames in the About screen), filtered to Latin America + Spain + world capitals, fields `name, country, admin1, lat, lng, tz`. Target < 1 MB gzipped.

## Daily horoscopes

Pipeline: **fetch free English horoscope → translate to Spanish → store both.**

Backend `horoscopes` app, two independent interfaces so each side can be swapped in one file:

- `HoroscopeSource.fetch(date, sign) -> str` (English)
  1. **freehoroscopeapi.com** (primary): free, no key, no account, JSON. Free horoscope services tend to disappear, so treat it as replaceable.
  2. **Manual**: paste/write in Django admin (fallback if the source dies).
- `Translator.translate(text, src="en", dst="es") -> str`
  1. **DeepL API Free** (primary): 500,000 chars/month free. Expected use ≈ 12 signs × ~600 chars × 30 days ≈ 220k/month. Use `formality=prefer_more` so translations address the reader as "usted". Key in env, server-side only.
  2. **None** (fallback): store English only and show it with an "(inglés)" label. She translates on her own device if needed (iOS/browser translate). No self-hosted LLM: the machine running Ollama isn't always on, and the homelab must be self-sufficient.
- Job runs daily at 04:00 America/Costa_Rica: for each of 12 signs, fetch → translate → upsert `horoscope` row with `text_en`, `text_es`, `source`, `translator`. Retries with backoff; each interface falls through to its next implementation. Skip translation if today's row already has `text_es` (protects the DeepL quota on re-runs).
- Track monthly DeepL usage (`GET /v2/usage`); above 90% of quota, stop translating and store English only until the quota resets. Retranslate those days' rows on the first run of the new billing period (optional).
- Clients receive horoscopes through normal sync (server-owned table) → available offline afterward. UI shows Spanish; long-press shows the English original.
- Data model change: `horoscope` gets `text_en`, `text_es`, `source`, `translator` (replacing `text`, `provider`).

## Security
- HTTPS only, via `tailscale serve` certs. Network access limited to the tailnet; Tailscale ACLs restrict her devices to the app port only.
- Still require app auth (JWT) — the tailnet is one layer, not the only one.
- JWT in IndexedDB (no cookies needed, same origin). Short access TTL (15 min), refresh 30 days.
- Rate limit `/api/auth/` (DRF throttling).
- Optional app PIN: gate UI only (data at rest in IndexedDB is not encrypted; document this honestly in README).
- Django admin reachable only on the tailnet (ACL: Mariano's devices only), with a separate strong admin password.

## Hosting the PWA on iOS — notes for the README
- Must be served over HTTPS for the service worker and install (the ts.net cert covers this).
- She installs once via Safari → Compartir → Agregar a inicio, **with Tailscale connected**. After that the app opens and works offline even with Tailscale off; only sync and app updates need it on.
- Install must be done from Safari itself, not from a link opened inside WhatsApp/Instagram.
- iOS allows one active VPN at a time: if she uses another VPN, sync waits until Tailscale is back on.
- iOS updates the service worker on next launch; show a "Nueva versión disponible — recargar" toast.
- Storage for installed home-screen apps is far less likely to be evicted than for regular Safari tabs, but backups remain mandatory.
