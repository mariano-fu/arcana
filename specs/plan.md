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
| API docs | `drf-spectacular` (OpenAPI at `/api/schema/`, auth required, no UI). The schema is committed as `api/openapi.yaml`; `web/src/sync/api.gen.ts` is generated from it with `openapi-typescript` (`npm run gen:api-types`) and committed too. CI regenerates both and fails on any diff; `web/src/sync/api-types.test.ts` fails the type check if the generated record types and `web/src/db/types.ts` drift apart |
| Scheduled jobs | Phase 4: management command run by a cron container. Stretch: Celery + Redis beat |
| Tests | pytest-django, factory_boy |
| Serving | gunicorn behind Caddy |
| Deploy | Docker Compose: `caddy`, `api`, `db`, `cron` (+ `redis`, `worker` if stretch) |
| Exposure | Tailscale only. `tailscale serve` on the homelab terminates HTTPS with an auto-provisioned cert for `https://<host>.<tailnet>.ts.net` and proxies to Caddy. PWA and `/api` share that origin → no CORS. Her iPhone and laptop run the Tailscale client (server node shared with her account, or she joins the tailnet). Nothing is reachable from the public internet |
| Backups | Nightly `pg_dump` to a second disk, 30-day retention |

References to seed-backed tables (`reading.spread_template_id`, and any crystal or intention tag references) are plain UUID fields on the server, not foreign keys: unedited seed rows never sync (see "Seed vs. user edits"), so the referenced row may not exist on the server.

## Data model

All synced tables share these columns:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (v7, generated on the client) | Lets devices create records offline without collisions. The exceptions are seed rows (see "Seed vs. user edits") and `card_draw` (see below) |
| `updated_at` | timestamptz (client clock) | Used for last-write-wins |
| `deleted_at` | timestamptz null | Tombstone |
| `server_version` | bigint | Server-assigned from a global sequence on every write; pull cursor |
| `device_id` | UUID | Which device last wrote it (debugging, conflict UI) |

Local-only (IndexedDB, never sent to the server):
- `pending` (`0|1`, not boolean, because IndexedDB can't index booleans): 1 while a row has unsynced changes. The sync push reads `where('pending').equals(1)`, tombstones included.
- `meta` key/value table: `device_id` (UUIDv7 created on first run), `seed_version:spreads` and `seed_version:crystals` (the bundled `version` last loaded, see "Seed vs. user edits"), `fresh_session:<id>` (a session just created by "Nueva sesión": its fields as created, its `updated_at`, and whether creating it unarchived the client; read and removed by the discard-on-leave check and the startup sweep in `features/sessions/actions.ts`), later the sync cursor.

Local conventions: field names stay snake_case so rows go to the sync API as-is; timestamps are ISO 8601 UTC strings (sort lexically, which last-write-wins relies on); `server_version` is null until first sync. Deletes are soft (`deleted_at` set, row re-stamped `pending`), and repository reads hide tombstones by default.

Tables:
- **client**: name, instagram, whatsapp, email, birth_date (date, null), birth_time (time, null), birth_place_label, birth_lat, birth_lng, birth_tz (IANA), notes, tags (text[]), archived (bool), created_at
- **session**: client_id, started_at, type (`in_person|online|message`), price_minor (int, null — céntimos/cents), currency (`CRC|USD`, default `CRC`), notes, follow_up_note, follow_up_date
- **payment**: session_id, client_id (denormalized for fast per-client totals), amount_minor (int), currency (`CRC|USD`), method (`sinpe|cash|transfer|paypal|other`), paid_at (date), reference (text, null — e.g. SINPE receipt number), note. Session status (`paid|partial|pending|no_charge|overpaid`) is **derived**, never stored, so it can't drift out of sync; a `paymentStatus(session, payments)` pure function owns that logic and is unit-tested.
- **reading**: session_id, spread_template_id, spread_snapshot, label, created_at. `spread_snapshot` (JSON: `{name, positions: [{index, name, meaning, layout}]}`, with `layout` as in `spread_template`, so past readings can redraw the spread's shape without the template) is a copy of the spread taken when the reading is created and never changed afterwards. Past readings always display from the snapshot, never from the current `spread_template`, so seed updates and her edits to custom spreads can't rewrite history. `spread_template_id` stays only as a reference (e.g. "readings with this spread") and may point to a template that has since changed or been deleted.
- **card_draw**: reading_id, position_index (1-based, matches `index` in the reading's `spread_snapshot.positions`), card_id (seed key, e.g. `major-00`, `cups-07`), reversed (bool), note. card_draw ids are UUIDv5 of `card_draw:<reading_id>:<position_index>`, so each position has at most one draw row across devices (exception to UUIDv7). Removing a card tombstones that row; placing a card there again revives it, keeping its note.
- **spread_template**: name, description (when to use it and how to read it; may be empty for custom spreads), positions (JSON: `[{index, name, meaning, layout}]`), is_seed, seed_key. `index` is the 1-based position number shown to her. Position numbers are 1-based everywhere: template positions, `reading.spread_snapshot.positions[].index` and `card_draw.position_index`. `layout` is `{col, row, rotated}` (0-based grid cell; `rotated` lays the card crosswise, e.g. the Cruz Celta's Desafío over card 1) or null for a custom spread without placement. Seed spreads are read-only; to change one she copies it into a custom spread (`is_seed = false`, `seed_key = null`). Custom spreads (builder, T1.10): 1–20 positions, numbered 1..N in list order on save; `meaning` and `description` may be empty; positions may mix a layout and `null`. Layouts follow the same rules as the seed (`spreadLayoutIssues` in `seed/spreads.ts`): inside the 7×5 grid (`SPREAD_GRID`), at most one upright and one crosswise card per cell, a crosswise card only over an upright one. Names are unique among live spreads, seed and custom, compared trimmed and case- and accent-insensitive; "Duplicar" names copies "<nombre> (copia)", "(copia 2)"… with the first free number.
- **crystal**: seed_key (null if user-created), name, colors, chakras, signs, intentions (tag keys), description, care, hidden, user_modified (bool). No inventory fields in v1. Future inventory goes in a separate `crystal_stock` table (crystal_id, quantity, cost_minor, price_minor, currency), so recommendations never depend on stock data.
- **intention_tag**: key, label (null for a seed tag she hasn't renamed: the UI shows the `es.json` label for the key, `crystals.intention.*`; her own tags and seed tags she renamed store a real label)
- **card_note**: card_id, note (her personal notes per card)
- **conflict**: table, record_id, field, losing_value, losing_device_id, created_at, resolved (bool)
- **horoscope** (server-owned, read-only on clients): date, sign, period (`day`), text_en, text_es, source, translator

Seed-only (bundled JSON, not synced, versioned): tarot cards, zodiac sign profiles, cities.

Tarot cards (`seed/cards.es.json`, schema in `seed/cards.ts`): key, arcana, number, suit, element, astrology (Golden Dawn), keywords, upright, reversed. Majors store their Spanish `name`. Minor names are not stored: they are built from the rank and suit labels in `es.json` (`cards.rank.*`, `cards.suit.*`, e.g. "Paje de Oros"), so renaming a suit or court rank is a one-line edit. Court ranks are numbered 11 Paje, 12 Caballero, 13 Reina, 14 Rey; the Ace is 1. Astrology (recorded in the seed's `astrology_system` field): attributions follow the Golden Dawn (Book T) system: decans for pips 2–10; courts use the "20° to 20°" ranges, with GD Knight → RWS Rey and GD Prince → RWS Caballero. ‘Elemento’ on the majors is the sign’s element for zodiac cards and ‘—’ for planet cards. The exceptions follow GD’s own elemental attributions: the three elemental trumps El Loco (Aire), El Colgado (Agua) and El Juicio (Fuego), and El Mundo (Saturno + Tierra). Uranus, Neptune and Pluto are deliberately left out (modern additions, not original GD). Meanings are gender-neutral toward the consultant (a test rejects common masculine-only words, with an allowlist). `docs/review/cards-es.md` is generated from the seed (`npm run build:cards-review`) for her review, and a test fails if it is stale.

Spreads (`seed/spreads.json`, schema in `seed/spreads.ts`): key, name, description, positions with layout (see `spread_template`). The seed holds the four agreed spreads: 1 carta, 3 cartas (pasado/presente/futuro), Herradura (7: pasado, presente, futuro próximo, consejo, entorno, esperanzas y temores, resultado) and Cruz Celta (10, modern order: 3 Base, 5 Corona, 7 La persona consultante). Descriptions and position meanings are written for a reader who is learning: when to use the spread, what to look for in each position. Texts pass the same gender-neutral check as the cards (shared helper in `src/test/gender-neutral.ts`). `docs/review/spreads-es.md` is generated (`npm run build:spreads-review`), with a text sketch of each layout, and a test fails if it is stale.

Zodiac (`seed/zodiac.es.json`, schema in `seed/zodiac.ts`): 12 signs in zodiac order with key (English, e.g. `scorpio`; crystals reference these), number, Spanish name, glyph, `start`/`end` (`{month, day}`, inclusive standard date table, Capricornio wraps the year; display only, `sunSign` never uses it), element, modality (`cardinal|fixed|mutable`), `ruler` (modern: Plutón, Urano, Neptuno for Escorpio, Acuario, Piscis) and `traditional_ruler` (classical seven only), traits (nouns, so they stay gender-neutral), description (strengths and shadow) and `compatible` (same element plus the complementary one: fire ↔ air, earth ↔ water; symmetric, 5 signs each) and `challenging` (the two square signs: same modality, three signs away, element neither its own nor the complementary one, e.g. Aries → Cáncer, Capricornio; symmetric, never also compatible). Planet and modality labels live in `es.json` (`astro.planet.*`, `zodiac.modality.*`, `zodiac.field.challenging` = "Signos desafiantes"). Texts pass the gender-neutral check.

Crystals (`seed/crystals.es.json`, schema in `seed/crystals.ts`): about 50 commonly recommended crystals, recommendation-only (no stock, price or quantity fields; the schema is strict, so they fail validation). Each has key (English kebab-case, e.g. `rose-quartz`; matches `crystal.seed_key`), Spanish name, colors, chakras, signs (zodiac seed keys), intentions, description and care (cleansing, plus water or sun sensitivity). Colors, chakras (the 7 main ones: `root, sacral, solarPlexus, heart, throat, thirdEye, crown`) and intentions are key enums with Spanish labels in `es.json` (`crystals.color.*`, `crystals.chakra.*`, `crystals.intention.*`). Intention keys name what the person seeks (`calm`, `rest`, `abundance`, `confidence`…), never a problem; T1.6 seeds an `intention_tag` row per key, with `label: null` (see `intention_tag`). Every sign has ≥ 3 crystals, every chakra ≥ 2 and every intention ≥ 3, so the recommender always has candidates. Descriptions frame associations and traditional uses ("se asocia con…", "tradicionalmente se usa para…"); a test rejects health-claim words (shared helper `src/test/health-claims.ts`: cura, sana, trata, alivia, enfermedad…) and the texts pass the gender-neutral check. `docs/review/crystals-es.md` is generated (`npm run build:crystals-review`), listing the intention tags first, and a test fails if it is stale.

### Card images
- Source: scans of the original 1909 Rider-Waite-Smith deck (Pamela Colman Smith artwork, public domain), e.g. the set on Wikimedia Commons. Record the exact source URL and license of each file in `web/src/seed/images/CREDITS.md`; never pull from modern commercial editions.
- Build script `scripts/build-card-images.ts` (sharp): resize to two sizes (thumb ~160 px wide, full ~600 px wide), convert to WebP, name by card key (`major-00.webp`, `cups-07.webp`). Commit outputs; target ≤ 5 MB total.
- Precached by the service worker so they work offline. Card seed entries reference images by key, not path.
- Reversed cards: same file, rotated with CSS (`transform: rotate(180deg)`).

### Seed vs. user edits (Principle 5)
On app start (`seed/loader.ts`, `loadSeed`), compare each bundled seed's `version` with the one stored in `meta` (`seed_version:spreads`, `seed_version:crystals`; intention tags follow the crystals version) and load only the seeds that differ, in one transaction, so running it twice or from two tabs is safe.
- **Ids:** seed rows are the one exception to UUIDv7 ids. Their id is a UUIDv5 of `"<table>:<seed_key>"` under a fixed namespace (`SEED_ID_NAMESPACE`, never changed), so every device creates the same rows and syncing never duplicates them; `reading.spread_template_id` points to the same spread everywhere.
- **Not synced by default:** the loader writes seed rows with `pending = 0`, because each device derives them from its own bundle. Only her edits (made through the repositories, `pending = 1`) sync. Rows that already exist keep their `pending` and `server_version`.
- **Crystals:** insert new seed rows; update existing seed rows **only if `user_modified = false`**, and then only the seed content (name, colors, chakras, signs, intentions, description, care), never `hidden`. Never touch her own crystals (`seed_key = null`).
- **Spreads:** seed spreads are read-only in the app, so seed rows are always updated to the bundled version (no `user_modified` flag); her custom spreads (`is_seed = false`) are never touched, and copies she made of a seed spread are independent custom rows.
- **Intention tags:** add-only. A seed key with no row (looked up by `key`) gets one with `label: null`; existing rows, renamed or not, are never updated.
- **Deletes:** a seed row she deleted (tombstone) stays deleted, and rows dropped from a newer seed are kept. The loader never deletes anything.

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
  "cursor":    1907,
  "server_time": "2026-10-19T12:00:00.000Z"
}
```

Single tenant: the server holds one practice's data. Any authenticated account syncs that one dataset; rows have no owner column. Multi-user is out of scope.

Server rules per incoming record:
1. If no existing row → insert, assign `server_version`.
2. If incoming `updated_at` > stored `updated_at` → overwrite. For free-text fields (`notes`, `follow_up_note`, `card_draw.note`, `card_note.note`, `payment.note`): if the stored value differs and was written by a different device since this device's cursor, store the losing value in `conflict`.
3. If incoming is older → reject that record, return the server's version in `changes` (even if it is at or below the cursor). Equal `updated_at`: from the same device, or with content identical to the stored row (a pulled row echoed back, e.g. a server-created conflict), it is the same write again and counts as applied without writing; otherwise the server's row wins. A rejected record's free-text fields get the same conflict check as rule 2, with the incoming value as the loser, so a device never silently loses text it typed.
4. Tombstones follow the same rules; a delete wins over an older edit. A child pushed for a tombstoned parent (a session for a deleted client) is accepted; the parent stays tombstoned and both are pulled (T3.7 surfaces it).

Details:
- **Conflict rows** are created by the server (`device_id` = nil UUID, `resolved = false`) with a deterministic id: UUIDv5 of `"<table>:<record_id>:<field>:<losing_updated_at>:<losing_device_id>"` under a fixed namespace (`CONFLICT_ID_NAMESPACE` in `sync/service.py`, never changed), inserted only if absent. A retried push therefore never duplicates or reopens a conflict. Conflict rows detected by a push come back in that push's `changes`, along with `conflicts: [{table, id, field}]`.
- **Wire format:** records are full rows with model field names; foreign keys travel as `<name>_id`. Pulled records include `server_version`; incoming `server_version` is ignored and `device_id` is taken from the request, not the record. Timestamps are sent as `YYYY-MM-DDTHH:MM:SS.sssZ` (JS `toISOString()`). Times (`birth_time`) travel as `HH:MM`. Everything is millisecond precision: incoming timestamps are truncated to ms before any comparison, and every timestamp the server generates (`updated_at`/`created_at` on rows it writes, `server_time`) is truncated too.
- **Pull:** rows with `server_version > cursor` from every table, ordered, at most 500. Rows this request wrote are left out but still advance `cursor` (the last `server_version` in the page, or the request's cursor if the page is empty).
- **Rejected pushes:** a push is applied all or nothing. Any bad record → `400`, nothing applied, `{records: [{index, table, id, code, detail}]}` with `code` one of `invalid`, `server_owned` (pushes to `horoscope`), `clock_ahead` (`updated_at` more than 24 h after server time), `constraint`, `missing_parent` (foreign key to a row that exists neither on the server nor in the push). Malformed requests (unknown table, more than 500 changes) → `400` with DRF field errors. Request bodies may be up to 10 MB (`DATA_UPLOAD_MAX_MEMORY_SIZE`).
- **One writer at a time:** every write to a synced table goes through `synced_write()` (`sync/models.py`): a transaction holding a Postgres advisory lock, in which `SyncedModel.save()` takes the next `server_version`. The sync view runs push and pull in one such transaction, and the admin, the horoscope job and management commands write through `save()` too. Without it, a transaction that took a lower `server_version` could commit after a pull read a higher one, and the cursor would skip that row. Bulk queryset writes (`update`, `bulk_update`, `bulk_create`) on synced models raise, since they bypass `save()`.
- **No hard deletes:** `delete()` on a synced row or queryset raises, because a deleted row never reaches a pull. Deletes are tombstones; the admin has no delete permission and offers a "tombstone" action instead (`SyncedModel.tombstone()`: server clock, nil device). Every foreign key on or to a synced model is `PROTECT`, so no cascade can hard-delete synced rows (tested).

Client rules:
- Every local write sets `updated_at = now`, `pending = true`.
- Sync runs on app open, on `online` event, every 5 min while visible, and on demand. Single-flight (no overlapping syncs).
- Paginate pull at 500 records; loop until `cursor` stops advancing.
- Clock skew: on each sync the server returns its time. If device skew > 2 min, show a warning in Settings.

Tests must cover: concurrent edits on two devices, delete vs. edit, offline for a week then sync, notes conflict preserved, re-sending the same push twice (idempotent).

## Astrology module (`web/src/astro/`)

Pure functions, no UI:
- `sunSign(birthDate, utc?)` → always from the Sun's ecliptic longitude (astronomy-engine), never from the date table (which is only for displaying ranges). With `utc` (time and place known, via `toUtc`): the sign at that instant. Date-only: compute the longitude at the day's two extreme instants (its start in UTC+14 and its end in UTC−12); same sign → `cusp: false`; different → `cusp: true`, primary sign = the sign at 12:00 UTC that day, `alternative` = the other.
- `toUtc(date, time | null, ianaTz)` → Luxon; when time is null, use 12:00 local and mark result `timeKnown: false`. A local time inside a DST gap (never existed) is shifted forward by the gap; a local time that occurred twice resolves to the earlier instant. The result's `adjusted` (`'none' | 'gap' | 'ambiguous'`) says which rule applied.
- `planetPositions(utc)` → sun, moon, mercury … pluto geocentric apparent longitudes on the true ecliptic of date via astronomy-engine → `{ longitude, sign, degree }` per planet (`degree` within the sign, 0–30).
- `moonSignUncertain(date, tz)` → true if the moon changes sign during that local day (from its first local instant per `toUtc` to the next day's).
- `ascendantAndHouses(utc, lat, lng)` → only when time known; Placidus (confirmed as her system), whole-sign as fallback where Placidus is undefined: |lat| ≥ 90° − true obliquity of date (≈ 66.56°), or if a cusp's semi-arc cannot be solved. Returns `{ system: 'placidus' | 'whole-sign', ascendant, mc, cusps }` (each `{ longitude, sign, degree }`, cusps for houses 1–12); the ascendant and MC are always computed, and under whole-sign the MC is reported as a point, not the 10th cusp.
- Zodiac: Western tropical (confirmed). No sidereal support needed.

Reference test set: 10+ charts with known positions (pick public charts and verify against a trusted online ephemeris). Tolerance 1°. Planet positions are checked against NASA JPL Horizons (DE441, geocentric, `QUANTITIES='31'`): `astro/fixtures/horizons-reference.json` records the source and query, and `npm run fetch:horizons-reference` regenerates it (needs network, never run in CI). Ascendant, MC and Placidus cusps are checked against `astro/fixtures/houses-reference.json`: values only, generated once outside the repo with Swiss Ephemeris (pyswisseph `swe_houses`, 'P'), tolerance 0.01°; its `source` block records the version and call. No Swiss Ephemeris code or script in the repo (AGPL). Cases include Costa Rica (incl. a DST year), the Southern hemisphere and Tromsø (whole-sign fallback; only Asc/MC compared).

Cities (`seed/cities.json`, generated by `npm run build:cities` from `web/scripts/build-cities.ts`; rules in `web/scripts/cities.ts`): GeoNames (CC BY 4.0, credited on the "Acerca de" screen). Central America (BZ, GT, SV, HN, NI, CR, PA) from `cities1000`; the rest of Latin America (MX, CU, DO, HT, PR and South America) and Spain from `cities15000`; elsewhere, national capitals (PPLC) from `cities15000`. Historical, abandoned and destroyed places are excluded. Fields: `name, label, country, lat, lng, tz` and optional `alt`; sorted by population, coordinates rounded to 4 decimals.
- City names: the Spanish preferred alternate name (isolanguage `es` and isPreferredName = 1), else the GeoNames name, which then stays searchable as `alt`.
- Province/canton names (admin1/admin2, via `admin1CodesASCII.txt`/`admin2Codes.txt`): preferred `es` name → first `es` name → GeoNames name, then a fixed list of administrative prefixes and suffixes is stripped ("Provincia de", "Cantón de", "Estado", " Province", …; matched ignoring case), except where the prefix is part of the name ("Distrito de Columbia").
- Country names: `Intl.DisplayNames` es-CR, resolved at build time and baked into the labels.
- Labels (unique; this is what `birth_place_label` stores): Costa Rica is city, canton (admin2), province, with no country ("San Rafael, Escazú, San José"). Latin America, Spain and the US: city, admin1, country. Elsewhere: city, country, plus admin1 when another entry in the same country has the same city name ("Portland, Oregón, Estados Unidos"). Consecutive repeated parts collapse ("San José, San José, San José" → "San José").
- Collision rule (for future GeoNames updates): if labels still clash, add the next admin level (admin2) to every entry in the clash; if that does not separate them, keep the most populous entry and drop the rest. The build prints every resolution, and a test requires unique labels.
- Size: the lazily loaded `cities-*.js` chunk must be in the service worker precache and under Workbox's 2 MiB per-file limit (`npm run build` fails otherwise, via `scripts/check-precache.ts`); target < 1 MB gzipped.
- Client form: offline autocomplete (max 8 suggestions; accent-insensitive). Picking a city fills `birth_place_label`, `birth_lat`, `birth_lng`, `birth_tz`; editing the text afterwards clears the coordinates. Manual fallback: latitude, longitude and an IANA timezone, all three or none. Older clients with a label but no coordinates keep the label and show "sin coordenadas".

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
- Endpoints: `POST /api/auth/token/` (username + password → access + refresh) and `POST /api/auth/token/refresh/` (refresh → new access + new refresh; the old refresh token is blacklisted). The API accepts only JWT (`Authorization: Bearer`), no session auth.
- Rate limit `/api/auth/` (DRF throttling, `AUTH_THROTTLE_RATE`, default 10/min per endpoint). The bucket is keyed by `REMOTE_ADDR` (the proxy) until T4.1 sets `NUM_PROXIES`.
- Optional app PIN: gate UI only (data at rest in IndexedDB is not encrypted; document this honestly in README).
- Django admin reachable only on the tailnet (ACL: Mariano's devices only), with a separate strong admin password.

## Hosting the PWA on iOS — notes for the README
- Must be served over HTTPS for the service worker and install (the ts.net cert covers this).
- She installs once via Safari → Compartir → Agregar a inicio, **with Tailscale connected**. After that the app opens and works offline even with Tailscale off; only sync and app updates need it on.
- Install must be done from Safari itself, not from a link opened inside WhatsApp/Instagram.
- iOS allows one active VPN at a time: if she uses another VPN, sync waits until Tailscale is back on.
- iOS updates the service worker on next launch; show a "Nueva versión disponible — recargar" toast.
- Storage for installed home-screen apps is far less likely to be evicted than for regular Safari tabs, but backups remain mandatory.
