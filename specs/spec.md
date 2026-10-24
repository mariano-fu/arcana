# Spec — Tarot Practice App

## Problem
A tarot reader starting a small business needs one place to keep track of her clients and their readings, with quick reference material (cards, astrology, crystals) at hand during a session. Today that lives in her head, her notes app and Instagram DMs. She uses an iPhone; she sometimes uses a laptop.

## Users
- **Primary:** the reader (one person, non-technical, Spanish-speaking, iPhone).
- **Secondary:** Mariano, as admin/maintainer (deploys server, restores backups).
- Clients never use the app.

## Out of scope (v1)
- Booking/calendar, payment processing (charging cards, payment links — v1 only *records* payments she received), client-facing portal, Instagram/WhatsApp integration, multiple readers, Android-specific work, App Store distribution, crystal inventory and sales (see Future).

---

## Feature 1 — Clients (Clientes)

**User stories**
- US-1.1: As the reader, I can add a client with name, contact (Instagram handle, WhatsApp number, email — all optional), birth date, and optionally birth time and birth place.
- US-1.2: I can search clients by name or handle and see them sorted by last visit.
- US-1.3: I can open a client and see: their profile, astrology summary, recommended crystals, and a timeline of all their sessions (newest first).
- US-1.4: I can keep free-text notes and tags on a client (e.g. "ansiedad", "trabajo", "cliente frecuente").
- US-1.5: I can archive (not delete) a client; I can permanently delete only after a confirmation.

**Acceptance criteria**
- Creating a client with only a name works. Birth date is strongly encouraged but optional (astrology sections show "Agregue fecha de nacimiento" when missing).
- Birth time has an explicit "No sabe la hora" option, stored as `null`, not as midnight.
- Search returns results as she types, with no network.

## Feature 2 — Sessions (Sesiones / Lecturas)

**User stories**
- US-2.1: As the reader, I can start a session for a client, which records date/time, session type (presencial, en línea, mensaje), and an optional price (Feature 2b).
- US-2.2: Inside a session I can do one or more tarot spreads (Feature 3), write notes, and attach recommended crystals.
- US-2.3: I can set a follow-up note and optional follow-up date ("revisar en 1 mes").
- US-2.4: On the home screen I see upcoming follow-ups and recent sessions.

**Acceptance criteria**
- A session autosaves; closing the app mid-reading loses nothing.
- "Nueva sesión" saves the session right away. If she leaves the session page with it still exactly as created (no field edited, no readings, no payments), it is discarded silently (tombstoned). If the app is closed first, the next app start discards it instead, as long as it was never modified. Only the device that created the session discards it.
- Starting a session for an archived client unarchives the client (they came back), with a short notice: "La ficha se desarchivó". If that session is then discarded as untouched, the client is archived again.
- Deleting a session asks for confirmation and lists what goes with it (readings, payments with totals per currency); its payments, readings and card draws are tombstoned with it.
- From a client's timeline I can open any past session and see exactly which cards were drawn, in which positions, upright or reversed.

## Feature 2b — Payments (Pagos)

**User stories**
- US-2b.1: When I create or edit a session I can set its price and currency (₡ colones by default, or US$).
- US-2b.2: I can record one or more payments against a session: amount, currency, method (SINPE Móvil, efectivo, transferencia, PayPal, otro), date, optional reference number and note. This covers deposits, partial payments and paying later.
- US-2b.3: Each session shows its status, derived from price vs. payments: **Pagado**, **Parcial**, **Pendiente**, or **Sin cobro** (no price / free reading).
- US-2b.4: On a client's profile I see what they've paid in total and any balance they still owe.
- US-2b.5: A "Pagos" screen shows: income for the selected month (per currency), sessions with pending balances (oldest first), and a list of payments I can filter by month, method and client.
- US-2b.6: I can export a month's payments as CSV (for her own records / taxes).

**Acceptance criteria**
- Amounts are stored as integers in the smallest unit (céntimos / cents), never floats.
- Currencies are never summed together; totals are shown per currency.
- Overpayment is allowed but flagged ("Saldo a favor").
- On a client's profile, per currency: total paid, "Pendiente" (sum of what each session still owes) and "Saldo a favor" (sum of overpayments) are shown separately, never netted against each other, so each open session stays visible. Payments in a currency other than the session's count toward "total pagado" but not toward that session's balance.
- A pending balance on a session appears on the home screen alongside follow-ups.
- Deleting a session with payments requires confirmation and deletes (tombstones) its payments too.
- On the "Pagos" screen, one month picker drives the income and the payment list; method and client filters only narrow the list. "Saldos pendientes" spans all months and archived clients, oldest session first, and leaves out paid, free and overpaid sessions.
- The CSV export (`pagos-YYYY-MM.csv`) holds every payment of the month, ignoring the list's filters, oldest first. It is shaped for Excel/Numbers in Spanish: UTF-8 with BOM, `;`-separated, amounts as `15000,00` (no symbol or grouping) so they stay numbers. Columns: Fecha, Cliente, Monto, Moneda, Método, Referencia, Nota. Text cells that would start a formula (`=`, `+`, `-`, `@`) get a leading `'`; amounts never do. Where the browser can share files (her iPhone's installed web app), it opens the share sheet; otherwise it downloads.
- Months group by `paid_at`, a calendar date taken from the device's local date when she records the payment (America/Costa_Rica on her devices), never from UTC: a payment at 23:30 on 31 October is October's.

## Feature 3 — Tarot spreads (Tiradas)

**User stories**
- US-3.1: I can pick a spread: 1 carta, 3 cartas (pasado/presente/futuro), Cruz Celta (10), Herradura (7), or a custom spread with N named positions.
- US-3.2: For each position I can pick the card I physically drew — fast: search by name or number, or browse by suit — and mark it reversed (invertida).
- US-3.3: Once a card is placed, I see its meaning for that orientation, keywords, and the meaning of the position, side by side.
- US-3.4: I can add a note per card/position.
- US-3.5: I can save my own custom spreads to reuse.
- US-3.6: I can add my own personal notes to any card in the deck reference, shown alongside the standard meaning.

**Acceptance criteria**
- Full 78-card deck (22 Arcanos Mayores + 56 Menores) with Spanish names, upright and reversed meanings, keywords, element/suit, and associated zodiac sign/planet where traditional.
- Picking a card for a position takes ≤ 3 taps on iPhone.
- The same card cannot be placed twice in one spread (warn, allow override for multi-deck readers).
- Every card shows its image alongside the text: a thumbnail in the card picker and spread grid, a larger image in the meaning panel and card reference. Reversed cards are shown rotated 180°.
- Images are the original 1909 Rider-Waite-Smith artwork (Pamela Colman Smith, public domain) from scans of the original deck. Never use modern recolored commercial editions. Source and license credited in the About screen.
- All 78 images are available offline (precached), optimized so the full set adds ≤ 5 MB to the app.

## Feature 4 — Astrology (Astrología)

**User stories**
- US-4.1: From birth date, I see the client's sun sign profile: sign, element, modality, ruling planet, traits, compatible signs.
- US-4.2: If birth place is provided, I see a natal chart summary: sun, moon and planets by sign. If birth time is also provided, I also see ascendant (rising) and houses.
- US-4.3: I see today's horoscope for the client's sun sign (and moon/rising if known), in Spanish.
- US-4.4: Natal chart calculations work offline.

**Acceptance criteria**
- Without birth time: UI clearly shows "Sin hora de nacimiento: no se calculan ascendente ni casas". Moon sign is shown with a warning if the moon changed sign that day.
- Birth place uses a bundled offline city list (Costa Rica + Latin America + major world cities) with lat/long and IANA timezone; manual lat/long/timezone entry as fallback.
- Historical timezone/DST is applied correctly (birth time is converted to UTC using the timezone rules in effect on that date).
- Planet positions within 1° of a reference ephemeris for a test set of known charts.
- Daily horoscopes: the latest available is shown with its date; if offline and today's isn't cached, show the most recent one with "Horóscopo del <fecha>".

## Feature 5 — Crystals (Cristales)

**User stories**
- US-5.1: I can browse/search a crystal library: name, color, chakra(s), associated signs, intentions it supports, short description, care/cleansing notes.
- US-5.2: On a client's profile, I see crystals recommended for their sun sign (and moon/rising if known).
- US-5.3: I can pick one or more intentions, phrased as what the person seeks ("calma", "amor", "protección", "abundancia", "descanso", "confianza"…), and get crystals ranked by how well they match the intentions + the client's signs.
- US-5.4: I can add, edit or hide crystals and intention tags (her own beliefs and knowledge win over the seed data).

**Acceptance criteria**
- Seed library of ~50 commonly recommended crystals in Spanish. She doesn't own crystals yet, so the library is purely a recommendation reference — no stock, prices or sales in v1.
- Ranking is explainable: each recommendation shows why ("Signo: Escorpio · Intención: protección").
- Crystal texts describe associations and traditional uses ("se asocia con…", "tradicionalmente se usa para…"), never health or medical claims (see constitution §5).
- The crystal data model leaves room for a future inventory/sales feature without migrating existing recommendations (see Future).

## Feature 6 — Sync & backup

**User stories**
- US-6.1: My data appears on both my iPhone and laptop when they've each had internet at some point.
- US-6.2: If I edit the same client on two devices while offline, nothing is silently lost.
- US-6.3: I can export everything to a file and import it back.
- US-6.4: I can see when the last successful sync was.

**Acceptance criteria**
- Sync runs on app open, on regaining connectivity, and on a manual "Sincronizar" button.
- Conflict policy: per-record last-write-wins by `updated_at`, EXCEPT free-text notes, where the losing version is preserved as a conflict copy she can review.
- Deletes propagate (tombstones). Archived ≠ deleted.
- Export → wipe local DB → import produces identical data (tested).

## Feature 7 — Settings
- Login to sync server, last sync time, manual sync, export/import, storage persistence status, seed data version, app version.
- Sync is optional: without login the app makes no requests to the API and nothing prompts the user to log in.
- Optional 4-digit PIN lock for the app (client data is private; the phone may be shared or handed over).

---

## Decisions confirmed with the reader (Oct 2026)
1. **Register:** "usted" throughout.
2. **Spreads:** the four in Feature 3 (1 carta, 3 cartas, Herradura, Cruz Celta) plus custom spreads.
3. **Payments:** yes, track them (Feature 2b).
4. **Card images:** yes, shown with the text (Feature 3).
5. **Crystals:** she doesn't own any yet; recommend only. Selling crystals is a possible future business line.
6. **Astrology system:** Western tropical zodiac, Placidus houses.

## Future (not v1, but don't design it out)
- **Crystal inventory & sales:** mark crystals in stock, cost/price, quantity, record a sale to a client (optionally inside a session), filter recommendations to in-stock. Sales would reuse the Payments model. Revisit when she starts sourcing crystals.
