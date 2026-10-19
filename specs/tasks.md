# Tasks

Work top to bottom. Each task should be one agent session / one PR. `[P]` = can run in parallel with its neighbors. Each phase ends in something she can use.

## Phase 0 — Repo & foundations
- [x] T0.1 Monorepo: `web/`, `api/`, `deploy/`, `docs/`, `specs/` (these four files), `CLAUDE.md`. MIT or private license, `.editorconfig`, root README stub.
- [x] T0.2 `web/`: Vite + React + TS strict, Tailwind, ESLint + Prettier, Vitest, i18next with `es` locale file. Hello screen in Spanish.
- [x] T0.3 `web/`: `vite-plugin-pwa` config, manifest (name, icons, theme color), offline app shell.
- [x] T0.3b De-risk iOS early: serve the hello-world build from the homelab via `tailscale serve`, install it on her iPhone over Tailscale, turn Tailscale off and confirm the app still opens offline.
- [x] T0.4 GitHub Actions: web lint + type-check + test + build.
- [x] T0.5 `docs/decisions/0001-offline-first.md` (ADR: why local DB + sync instead of API-first).

## Phase 1 — Usable on her phone with no backend
- [x] T1.1 Dexie schema v1 for all synced tables (plan.md data model), including `pending` flag and UUIDv7 ids. Repository layer with typed CRUD; every write stamps `updated_at`, `device_id`, `pending`.
- [x] T1.2 [P] Seed data: `cards.es.json` — 78 cards (key, número, nombre, arcano, palo, elemento, astrología, palabras clave, significado derecho, significado invertido). Draft with AI, **she reviews**. Zod schema + test that all 78 exist and keys are unique.
- [x] T1.2r Her review of the card texts. She marks corrections in `docs/review/cards-es.md`; apply them to `cards.es.json` and regenerate the doc (`npm run build:cards-review`).
- [x] T1.3 [P] Seed data: `spreads.json` (1, 3, Herradura 7, Cruz Celta 10) with Spanish position names and meanings.
- [x] T1.4 [P] Seed data: `zodiac.es.json` (12 signs: fechas, elemento, modalidad, regente, rasgos, compatibilidades).
- [x] T1.5 [P] Seed data: `crystals.es.json` (~50) + intention tags. She reviews.
- [x] T1.5b [P] Card images: download the 1909 RWS scans, record sources in `CREDITS.md`, `scripts/build-card-images.ts` → thumb + full WebP per card key. Check total ≤ 5 MB. Add to service-worker precache.
- [x] T1.6 Seed loader with versioning and the "don't overwrite user-modified rows" rule. Tests.
- [x] T1.7 Clients: list (search, sort by last visit), create/edit form (with "No sabe la hora"), detail page shell, archive/delete. Any bottom navigation must respect the bottom safe-area inset (home indicator), and the status bar color must match the app background.
- [x] T1.8 Sessions: create from client, autosave notes, type, price + currency, follow-up. Client timeline.
- [x] T1.8b Payments core: `paymentStatus()` and money helpers (integer minor units, per-currency totals, ₡/US$ formatting in es-CR). Unit tests incl. partial, overpaid, mixed currencies, free reading.
- [ ] T1.8c Payments UI: record/edit/delete payments on a session (method, date, reference), status badge on sessions, client totals + balance.
- [ ] T1.8d "Pagos" screen: monthly income per currency, pending balances list, filterable payment list, CSV export for a month.
- [ ] T1.9 Spreads: choose template → position grid with card thumbnails → card picker (search + browse by suit with thumbnails, ≤3 taps) → reversed toggle (image rotates) → meaning panel (full image + card meaning + position meaning + her card note). Save into session. Creating the reading must write `reading.spread_snapshot` (spread name + each position's number, name, meaning, layout `{col, row, rotated}`); past readings render from the snapshot, never from the current template.
- [ ] T1.10 Custom spread builder.
- [ ] T1.11 Card reference screen (image + meanings) with her personal notes per card.
- [ ] T1.12 Home: upcoming follow-ups, pending balances, recent sessions.
- [ ] T1.13 Export to JSON / import from JSON (Zod-validated, versioned format). Round-trip test.
- [ ] T1.14 Settings: storage persistence request + status, export/import, versions.
- [ ] T1.15 Playwright e2e on WebKit iPhone viewport: create client → session → Cruz Celta → reload offline → data still there. Runs in CI on Ubuntu (GitHub Actions), not locally: Playwright doesn't support Arch-based distros.
- [ ] T4.7 Service-worker update toast ("Nueva versión disponible — recargar"). Moved up from Phase 4. Switches `registerType` in `web/pwa.config.ts` to `prompt`.
- [ ] T1.16 Storage survival check on her iPhone: confirm `navigator.storage.persist()` was granted, and after a week of real use verify all data is intact; record results in `docs/spikes/`.
- [ ] **Checkpoint:** she uses it for real readings for a week. Collect feedback, update `spec.md`.

## Phase 2 — Astrology & crystals (offline)
- [x] T2.1 `astro/` sun sign + cusp handling. Tests.
- [ ] T2.2 Cities dataset build script (GeoNames subset → `cities.json`). Offline city autocomplete in client form; manual lat/lng/tz fallback.
- [x] T2.3 `astro/` `toUtc` with historical timezones. Tests incl. Costa Rica DST years (CR used DST briefly — verify which years) and a Southern-hemisphere case.
- [ ] T2.4 `astro/` planet positions via astronomy-engine + moon-sign uncertainty. Reference-chart tests (±1°).
- [ ] T2.5 `astro/` ascendant + Placidus houses (+ whole-sign fallback). Reference tests.
- [ ] T2.6 Client astrology panel: sun profile; natal summary when place known; rising/houses when time known; clear messaging when data is missing. When `toUtc` returns `adjusted` other than `'none'`, show a short warning, e.g. "Esta hora coincide con un cambio de horario; el ascendente podría variar."
- [ ] T2.7 Crystal library: browse, search, filter by chakra/sign/intention; add/edit/hide.
- [ ] T2.8 Crystal recommender: score = sign matches (sun ×2, moon ×1, rising ×1) + intention matches ×3; show reasons. Unit tests.
- [ ] T2.9 Recommendations on client detail and inside a session (attach to session).

## Phase 3 — Backend & sync
- [x] T3.1 `api/`: Django 5 + DRF + Postgres, settings via env, pytest, mypy, ruff. Dockerfile. CI job.
- [x] T3.2 Models mirroring the data model + global `server_version` sequence. Admin registered. References to seed-backed tables (`reading.spread_template_id`, crystal and intention tag references) are plain UUID fields, not foreign keys, since unedited seed rows never sync (plan.md, Backend).
- [ ] T3.3 Auth: simplejwt login/refresh, throttling. Tests.
- [ ] T3.4 `POST /api/sync/` implementing plan.md rules. Tests for every scenario listed in plan.md.
- [ ] T3.5 OpenAPI via drf-spectacular; generate TS types for the web client.
- [ ] T3.6 `web/sync/` engine: push pending → apply response → pull pages → advance cursor. Single-flight, triggers (open, online, interval, manual). Unit tests with a fake server.
- [ ] T3.7 Conflict review screen ("Conflictos": show both versions, keep one or merge text).
- [ ] T3.8 Settings: login, last sync, sync now, clock-skew warning.
- [ ] T3.9 Two-device e2e: two browser contexts, offline edits on both, sync, assert outcome.

## Phase 4 — Deploy & horoscopes
- [ ] T4.1 `deploy/docker-compose.yml`: caddy (serves built PWA + proxies /api), api, db, cron. `.env.example`. Caddy must serve .webmanifest as application/manifest+json.
- [ ] T4.2 Tailscale setup doc in `docs/deploy.md`: enable MagicDNS + HTTPS certificates, `tailscale serve` → Caddy, share the node with her account, ACL limiting her to the app port. Install on her iPhone from the ts.net URL.
- [ ] T4.3 Nightly `pg_dump` backups + tested restore procedure.
- [ ] T4.4 Spike (1 evening): call freehoroscopeapi.com for all 12 signs, check response shape and text length; translate a sample with DeepL Free (test `formality`), review quality. ADR with decision.
- [ ] T4.5 `horoscopes` app: `HoroscopeSource` (freehoroscopeapi, manual) and `Translator` (DeepL Free, none) interfaces. Daily job: fetch → translate → upsert `text_en`/`text_es`; skip re-translation; DeepL quota check that falls back to English-only above 90%. Tests with mocked HTTP, including DeepL down and quota exceeded.
- [ ] T4.6 Horoscope on client detail (sun + moon/rising if known), Spanish with English original on long-press, synced and cached, dated when stale.

## Phase 5 — Polish & portfolio
- [ ] T5.1 Optional PIN lock.
- [ ] T5.2 Accessibility pass (contrast, font sizes, VoiceOver labels).
- [ ] T5.3 README: problem, screenshots/GIF from iPhone, architecture diagram, offline-first + sync design and trade-offs, how to run locally, test coverage badge.
- [ ] T5.4 Demo mode with fake clients (never real data in screenshots or a public demo).
- [ ] T5.5 Stretch: move daily job to Celery + Redis; add structured logging + a basic health/metrics endpoint.

## Later — when she starts sourcing crystals
- [ ] TL.1 Crystal inventory (`crystal_stock` table), in-stock filter on recommendations, record crystal sales reusing the Payments model. Write a spec addendum first.
