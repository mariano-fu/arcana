// Row types for the local IndexedDB. Field names are snake_case so rows can be sent
// to the sync API as-is (see specs/plan.md, "Data model").

/** ISO 8601 UTC timestamp, e.g. `2026-10-18T14:03:00.000Z`. Sorts lexically. */
export type IsoDateTime = string;
/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Local time of day, `HH:mm`. */
export type IsoTime = string;

/** Columns shared by every synced table. */
export interface SyncedRow {
  id: string;
  updated_at: IsoDateTime;
  deleted_at: IsoDateTime | null;
  /** Assigned by the server; null until the row has been synced. */
  server_version: number | null;
  device_id: string;
  /** Local-only: 1 when the row has unsynced changes. A number because IndexedDB can't index booleans. */
  pending: 0 | 1;
}

export type Currency = 'CRC' | 'USD';
export type SessionType = 'in_person' | 'online' | 'message';
export type PaymentMethod = 'sinpe' | 'cash' | 'transfer' | 'paypal' | 'other';

export interface Client extends SyncedRow {
  name: string;
  instagram: string | null;
  whatsapp: string | null;
  email: string | null;
  birth_date: IsoDate | null;
  birth_time: IsoTime | null;
  birth_place_label: string | null;
  birth_lat: number | null;
  birth_lng: number | null;
  /** IANA timezone, e.g. `America/Costa_Rica`. */
  birth_tz: string | null;
  notes: string;
  tags: string[];
  archived: boolean;
}

export interface Session extends SyncedRow {
  client_id: string;
  started_at: IsoDateTime;
  type: SessionType;
  /** Integer minor units (céntimos/cents); null when no price was set. */
  price_minor: number | null;
  currency: Currency;
  notes: string;
  follow_up_note: string;
  follow_up_date: IsoDate | null;
}

export interface Payment extends SyncedRow {
  session_id: string;
  /** Denormalized from the session for fast per-client totals. */
  client_id: string;
  /** Integer minor units. */
  amount_minor: number;
  currency: Currency;
  method: PaymentMethod;
  paid_at: IsoDate;
  reference: string | null;
  note: string;
}

export interface Reading extends SyncedRow {
  session_id: string;
  spread_template_id: string;
  label: string | null;
  created_at: IsoDateTime;
}

export interface CardDraw extends SyncedRow {
  reading_id: string;
  position_index: number;
  /** Seed card key, e.g. `major-00`, `cups-07`. */
  card_id: string;
  reversed: boolean;
  note: string;
}

export interface SpreadPosition {
  index: number;
  name: string;
  meaning: string;
}

export interface SpreadTemplate extends SyncedRow {
  name: string;
  positions: SpreadPosition[];
  is_seed: boolean;
  seed_key: string | null;
}

export interface Crystal extends SyncedRow {
  /** Null for crystals she created herself. */
  seed_key: string | null;
  name: string;
  colors: string[];
  chakras: string[];
  signs: string[];
  /** Intention tag keys. */
  intentions: string[];
  description: string;
  care: string;
  hidden: boolean;
  user_modified: boolean;
}

export interface IntentionTag extends SyncedRow {
  key: string;
  label: string;
}

export interface CardNote extends SyncedRow {
  card_id: string;
  note: string;
}

export interface Conflict extends SyncedRow {
  table: SyncedTableName;
  record_id: string;
  field: string;
  losing_value: string | null;
  losing_device_id: string;
  created_at: IsoDateTime;
  resolved: boolean;
}

/** Server-owned: clients only receive these through sync. */
export interface Horoscope extends SyncedRow {
  date: IsoDate;
  sign: string;
  period: 'day';
  text_en: string;
  /** Null when translation was skipped (quota/translator down). */
  text_es: string | null;
  source: string;
  translator: string | null;
}

export interface SyncedTables {
  client: Client;
  session: Session;
  payment: Payment;
  reading: Reading;
  card_draw: CardDraw;
  spread_template: SpreadTemplate;
  crystal: Crystal;
  intention_tag: IntentionTag;
  card_note: CardNote;
  conflict: Conflict;
  horoscope: Horoscope;
}

export type SyncedTableName = keyof SyncedTables;

/** Local-only key/value store (device id, later seed version and sync cursor). Never synced. */
export interface MetaRow {
  key: string;
  value: string;
}
