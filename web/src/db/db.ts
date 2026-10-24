import { Dexie, type Table } from 'dexie';

import { monotonicUpdatedAt, type LocalWriteListener } from './monotonic';
import type {
  AuthRow,
  CardDraw,
  CardNote,
  Client,
  Conflict,
  Crystal,
  Horoscope,
  IntentionTag,
  MetaRow,
  Payment,
  Reading,
  Session,
  SessionCrystal,
  SpreadTemplate,
  SyncedTableName,
} from './types';

// Every synced table indexes `pending` (sync push) and `server_version` (pull cursor).
const SYNCED = 'id, pending, server_version';

export const SCHEMA_V1: Record<Exclude<SyncedTableName, 'session_crystal'> | 'meta', string> = {
  client: `${SYNCED}, name`,
  session: `${SYNCED}, client_id, started_at, follow_up_date`,
  payment: `${SYNCED}, session_id, client_id, paid_at`,
  reading: `${SYNCED}, session_id`,
  card_draw: `${SYNCED}, reading_id, card_id`,
  spread_template: `${SYNCED}, seed_key`,
  crystal: `${SYNCED}, seed_key`,
  intention_tag: `${SYNCED}, key`,
  card_note: `${SYNCED}, card_id`,
  conflict: `${SYNCED}, record_id`,
  horoscope: `${SYNCED}, [date+sign]`,
  meta: 'key',
};

/** v2: `auth`, the JWTs, apart from `meta` (see `AuthRow`). Every v1 table is unchanged. */
export const SCHEMA_V2: Record<'auth', string> = {
  auth: 'key',
};

/** v3: `session_crystal`, the crystals attached to a session (T2.9). Every v2 table is unchanged. */
export const SCHEMA_V3: Record<'session_crystal', string> = {
  session_crystal: `${SYNCED}, session_id, crystal_id`,
};

/** Tables whose rows sync: everything in v1 but `meta`, plus v3's. They refuse hard deletes. */
export const SYNCED_TABLE_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(SCHEMA_V1).filter((name) => name !== 'meta'),
  ...Object.keys(SCHEMA_V3),
]);

export const DEFAULT_DB_NAME = 'arcana';

// Plain `Table` rather than `EntityTable`: ids are always generated before insert, never by IndexedDB.
export class ArcanaDB extends Dexie {
  client!: Table<Client, string>;
  session!: Table<Session, string>;
  payment!: Table<Payment, string>;
  reading!: Table<Reading, string>;
  card_draw!: Table<CardDraw, string>;
  spread_template!: Table<SpreadTemplate, string>;
  crystal!: Table<Crystal, string>;
  intention_tag!: Table<IntentionTag, string>;
  card_note!: Table<CardNote, string>;
  session_crystal!: Table<SessionCrystal, string>;
  conflict!: Table<Conflict, string>;
  horoscope!: Table<Horoscope, string>;
  meta!: Table<MetaRow, string>;
  auth!: Table<AuthRow, string>;

  private readonly localWriteListeners = new Set<LocalWriteListener>();

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2);
    this.version(3).stores(SCHEMA_V3);
    this.use(
      monotonicUpdatedAt(() => {
        for (const listener of this.localWriteListeners) listener();
      }, SYNCED_TABLE_NAMES),
    );
  }

  /** Calls `listener` after each local edit (a write with `pending = 1`). Returns an unsubscribe. */
  onLocalWrite(listener: LocalWriteListener): () => void {
    this.localWriteListeners.add(listener);
    return () => this.localWriteListeners.delete(listener);
  }
}
