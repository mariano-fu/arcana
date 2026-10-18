# Constitution — Tarot Practice App (working name: "Arcana")

Non-negotiable principles. Every spec, plan, task and code change must comply. If a task conflicts with this file, stop and flag it.

## 1. Offline-first, always
- The app MUST be fully usable with no network: clients, sessions, spreads, card info, crystals, natal charts.
- The device's local database (IndexedDB) is the primary store the UI reads and writes. The server is a sync peer and backup, never a dependency for core features.
- Only two features may require network: sync, and fetching new daily horoscopes. Both degrade gracefully (show last cached data + "sin conexión" state).

## 2. Her data stays hers
- Client data is personal and sensitive. No third-party analytics, trackers, CDNs or external fonts at runtime.
- The sync server runs on Mariano's homelab only. All traffic over HTTPS. Auth required on every endpoint except health check.
- One-tap full export (JSON) and import must always work, independent of the server.

## 3. Spanish UI, English code
- All user-facing text is Spanish (Costa Rica), addressing the user as **"usted"**. This applies to UI copy, seed content and translated horoscopes. Use an i18n layer from day one so strings are not hardcoded.
- Code, commits, docs, API field names and tests are in English.

## 4. iPhone is a first-class target
- Must work as an installed PWA on iOS Safari (Add to Home Screen) and in a desktop browser.
- Touch targets ≥ 44px, works one-handed during a reading, no hover-only interactions.
- Request persistent storage (`navigator.storage.persist()`) and remind her to back up if it's denied.

## 5. Content is data, not code
- Tarot cards, spreads, crystals, zodiac profiles live in versioned seed data files (JSON), not in components.
- She can edit crystal and card notes in the app; her edits never get overwritten by seed updates.

## 6. Quality bar (this is a portfolio project)
- TypeScript strict mode; Python type hints + mypy.
- Every sync and astrology function has unit tests. Sync conflict rules have dedicated tests.
- CI runs lint, type-check and tests on every push. Docker Compose brings up the backend with one command.
- README explains architecture and trade-offs well enough for a hiring manager to follow in 5 minutes.

## 7. Small, shippable increments
- Each phase in `tasks.md` ends in something she can actually use. Phase 1 must be useful with no backend at all.
