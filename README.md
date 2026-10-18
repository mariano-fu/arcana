# Arcana

> Working name. Offline-first practice app for a tarot reader: clients, sessions,
> spreads, payments, card and crystal reference, natal charts and daily horoscopes.

**Status:** Phase 0 — repo and foundations. A full README (architecture, trade-offs,
screenshots, how to run) comes in T5.3.

## Why it's interesting

The UI never talks to the server for data. It reads and writes a local IndexedDB
database, and a background sync engine reconciles it with a self-hosted Django API
when the network is available. The app works fully offline as an installed PWA on iOS.

## Repo layout

| Path | What |
|---|---|
| `web/` | PWA: Vite + React + TypeScript, Dexie (IndexedDB), sync engine, astrology module |
| `api/` | Sync server: Django + DRF + PostgreSQL, daily horoscope job |
| `deploy/` | Docker Compose (Caddy, api, db, cron) for the homelab |
| `docs/` | Architecture decision records and deploy notes |
| `specs/` | Source of truth: [constitution](specs/constitution.md), [spec](specs/spec.md), [plan](specs/plan.md), [tasks](specs/tasks.md) |

## License

[MIT](LICENSE)
