# ADR 0001: Offline-first, with local IndexedDB as the source the UI reads

- Status: Accepted
- Date: 2026-10-18
- Related: `specs/constitution.md` §1, §4; `specs/plan.md` (Architecture, Sync protocol); `docs/spikes/t0.3b-ios-offline.md`

## Context

The app is for one tarot reader who uses an installed PWA on her iPhone and a browser on
her laptop. She works during readings, in person, online or over messages, and often
somewhere with a weak signal or none. She can't wait for a spinner while a client is in
front of her.

The server runs on Mariano's homelab, and the only way to reach it is over Tailscale
(`tailscale serve`, nothing public). iOS allows only one active VPN at a time, so the
server will regularly be out of reach even when the phone is online. Client data is
personal and sensitive, so it must not leave her devices and the homelab.

The constitution (§1) already requires that clients, sessions, spreads, card info,
crystals and natal charts all work with no network.

## Decision

The UI reads and writes **only** the local database: IndexedDB through Dexie, with
`useLiveQuery` for reactive reads. It never calls the API for data.

A separate **sync engine** reconciles IndexedDB with the server in the background,
through a single endpoint (`POST /api/sync/`) that pushes first, then pulls, and is
idempotent:

- Records get UUIDv7 ids on the client, so a device can create records offline without
  collisions.
- Every local write stamps `updated_at`, `device_id` and `pending = true`. The pull cursor
  is a `server_version` the server assigns.
- Conflicts resolve last-write-wins on `updated_at`. Deletes are tombstones. When a
  free-text field (notes) loses a conflict, its value is kept in `conflict` instead of
  being dropped.
- Sync runs on app open, on the `online` event, every 5 minutes while the app is
  visible, and on demand. Only one sync runs at a time.

The server is a sync peer and a backup. No core feature depends on it.

## Alternatives considered

**API-first.** The UI fetches from and writes to Django directly, which is the usual SPA
setup. It's simpler: the server is the only copy, so there are no conflicts. It fails our
main constraint, though. With Tailscale off, another VPN on, or no signal, she can't open
a client or record a session. This was rejected.

**API with a client cache.** Reads go through React Query/SWR or a service worker cache
of GET responses. Data she has already seen would load offline. But the cache only holds
what she happened to open, so a client she hasn't viewed recently is missing. Writes made
offline need a queue, retries and conflict handling, which turns into a sync engine
anyway, just a worse one bolted onto request caching. The UI would also have two code
paths: online and "maybe stale". This was rejected because it costs most of what sync
costs without making offline reliable.

## Trade-offs we accept

- **Sync conflicts.** Two devices can edit the same record. Last-write-wins can lose an
  edit to a structured field, and it relies on device clocks. Mitigations: notes conflicts
  are kept, deletes follow the same timestamp rules, the server returns its time so
  Settings can warn about clock skew over 2 minutes, and dedicated tests cover concurrent
  edits, delete vs. edit, a week offline, and duplicate pushes.
- **Storage per device.** Each device has its own full copy. A new or reset device starts
  empty until its first sync, and anything not yet synced exists only on that device.
  Storage use grows on every device, not just the server.
- **Safari storage eviction.** WebKit can clear IndexedDB for a site under storage
  pressure or when the site isn't used for a while. Installed home-screen apps are said to
  be at lower risk, but we haven't verified this ourselves. Mitigations: install as a PWA,
  request `navigator.storage.persist()` and remind her to back up if it's denied, sync to
  the server whenever it can be reached, and a one-tap JSON export/import that doesn't
  depend on the server (constitution §2, §4).
- **No encryption at rest on the device.** IndexedDB isn't encrypted. The optional PIN
  only locks the UI. The README says this plainly.
- **More code.** The sync engine, schema migrations on the client, and conflict rules are
  ours to build and test. We accept this cost because offline is the core of the product,
  and it's also the main architecture story for the portfolio.

## Evidence

The T0.3b spike (2026-10-18, iPhone 15, iOS 26.6.1) installed the PWA from Safari over
Tailscale. Once installed, the app opened as a standalone app with Tailscale off and in
airplane mode. Install has to be done from Safari itself, not from a link opened inside
WhatsApp or Instagram.

The spike covered only the offline **app shell**, not stored data. It doesn't show how
long IndexedDB data survives on iOS, so the eviction risk above stays open until the app
stores real data. The follow-up is T1.16 in `specs/tasks.md`. It confirms
`navigator.storage.persist()` was granted on her iPhone, checks after a week of real use
that all data is intact, and records the results in `docs/spikes/`.
