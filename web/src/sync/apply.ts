// What a sync does to IndexedDB (specs/plan.md, "Client rules"). Each function is one
// transaction, so closing the app mid-sync leaves either all of a step or none of it.

import type { Table } from 'dexie';

import {
  writeVerbatim,
  type ArcanaDB,
  type IsoDateTime,
  type SyncedRow,
  type SyncedTableName,
  type SyncedTables,
} from '../db';
import { isUntouchedSeedRow } from '../seed/loader';
import type { PushChange, SyncResponse } from './api';
import { CURSOR_KEY, EPOCH_KEY, type SyncError } from './status';
import {
  fromPulled,
  isPushable,
  PUSH_ORDER,
  SYNCED_TABLES,
  toPushChange,
  type PulledRecordOf,
  type PushableTable,
} from './wire';

/** A pushed row's `updated_at` as it was read for the push, by row id. */
export type PushSnapshot = ReadonlyMap<string, { table: PushableTable; updated_at: IsoDateTime }>;

export const NOTHING_PUSHED: PushSnapshot = new Map();

function tableOf<T extends SyncedTableName>(
  db: ArcanaDB,
  table: T,
): Table<SyncedTables[T], string> {
  return db.table<SyncedTables[T], string>(table);
}

const pushTables = (db: ArcanaDB) => PUSH_ORDER.map((table) => db.table(table));

/** Every pending row, parents first, and the snapshot to recognize them in the response. */
export function readPending(
  db: ArcanaDB,
): Promise<{ changes: PushChange[]; snapshot: PushSnapshot }> {
  return db.transaction('r', pushTables(db), async () => {
    const changes: PushChange[] = [];
    const snapshot = new Map<string, { table: PushableTable; updated_at: IsoDateTime }>();
    async function collect(table: PushableTable) {
      for (const row of await tableOf(db, table).where('pending').equals(1).toArray()) {
        changes.push(toPushChange(table, row));
        snapshot.set(row.id, { table, updated_at: row.updated_at });
      }
    }
    for (const table of PUSH_ORDER) await collect(table);
    return { changes, snapshot };
  });
}

/**
 * Applies one sync response in one transaction with the cursor, so the cursor never gets ahead
 * of the rows it covers. What happened to each pushed row comes only from `results`, never
 * from which rows are in `changes`:
 * - A pulled row overwrites a local row that isn't pending. A pending local row is overwritten
 *   only when `results` marks that row `rejected` and it is unchanged since it was read for the
 *   push: the server's row (in `changes`) won.
 * - `applied` / `noop`: `pending` is cleared if the row is unchanged since the push. An edit
 *   made meanwhile stays pending for the next push.
 * Pulled rows are stored first, while the pushed rows are still pending, so a server copy of a
 * row this push wrote can't overwrite it.
 */
export function applyResponse(
  db: ArcanaDB,
  body: SyncResponse,
  snapshot: PushSnapshot,
): Promise<void> {
  const tables = [...SYNCED_TABLES.map((table) => db.table(table)), db.meta];
  return db.transaction('rw', tables, async () => {
    const settled: { table: PushableTable; id: string; updated_at: IsoDateTime }[] = [];
    const rejected = new Set<string>();
    for (const result of body.results) {
      const pushed = snapshot.get(result.id);
      if (pushed?.table !== result.table) {
        console.warn('Sync result for a row not in this push; ignored', result);
        continue;
      }
      if (result.status === 'rejected') rejected.add(rowKey(result.table, result.id));
      else settled.push({ table: result.table, id: result.id, updated_at: pushed.updated_at });
    }

    for (const change of body.changes) await storePulled(db, change, snapshot, rejected);

    for (const { table, id, updated_at } of settled) {
      const rows = db.table<SyncedRow, string>(table);
      const row = await rows.get(id);
      if (row?.pending === 1 && row.updated_at === updated_at) {
        await rows.put({ ...row, pending: 0 });
      }
    }
    await db.meta.bulkPut([
      { key: CURSOR_KEY, value: String(body.cursor) },
      { key: EPOCH_KEY, value: body.epoch },
    ]);
  });
}

const rowKey = (table: string, id: string) => `${table}:${id}`;

async function storePulled<T extends SyncedTableName>(
  db: ArcanaDB,
  change: { table: T; record: PulledRecordOf<T> },
  snapshot: PushSnapshot,
  rejected: ReadonlySet<string>,
): Promise<void> {
  const table = tableOf(db, change.table);
  const local = await table.get(change.record.id);
  const lost =
    local !== undefined &&
    rejected.has(rowKey(change.table, change.record.id)) &&
    local.updated_at === snapshot.get(change.record.id)?.updated_at;
  if (local === undefined || local.pending === 0 || lost) {
    // Tombstones and conflict rows are stored like any other row.
    await table.put(fromPulled(change.table, change.record));
  }
}

/** Seed rows the server never had and that are still as bundled; see `isUntouchedSeedRow`. */
const leftOutOfRepush: { [T in PushableTable]: (row: SyncedTables[T]) => boolean } = {
  ...isUntouchedSeedRow,
  client: () => false,
  session: () => false,
  payment: () => false,
  reading: () => false,
  card_draw: () => false,
  card_note: () => false,
  conflict: () => false,
};

function leftOut<T extends PushableTable>(table: T, row: SyncedTables[T]): boolean {
  return leftOutOfRepush[table](row);
}

/**
 * Marks a table's rows pending, live or tombstoned, except untouched seed rows the server never
 * had. Callers loop over `PUSH_ORDER` inside their transaction: one level of native `await`
 * below the transaction scope, which Dexie keeps the transaction alive across.
 */
async function markForPush(db: ArcanaDB, table: PushableTable): Promise<void> {
  const rows = await tableOf(db, table).where('pending').equals(0).toArray();
  await tableOf(db, table).bulkPut(
    rows
      .filter((row) => row.server_version !== null || !leftOut(table, row))
      .map((row) => ({ ...row, pending: 1 })),
  );
}

/**
 * The server's database changed (its epoch differs from the stored one): the cursor refers to
 * another database, which may lack rows this device already pushed. Marks every row pending
 * again and resets the cursor to 0, keeping each `updated_at` exactly as is so last-write-wins
 * compares the real edit times on the re-push.
 */
export function resetForEpoch(db: ArcanaDB, epoch: string): Promise<void> {
  return writeVerbatim(db, [...pushTables(db), db.meta], async () => {
    for (const table of PUSH_ORDER) await markForPush(db, table);
    await db.meta.bulkPut([
      { key: CURSOR_KEY, value: '0' },
      { key: EPOCH_KEY, value: epoch },
    ]);
  });
}

/**
 * Before this device's first sync (no epoch stored, cursor 0): rows written before sync
 * existed may carry `pending = 0` without ever having reached the server, so every row is
 * marked pending, `updated_at` unchanged, as for an epoch change. Untouched seed rows still
 * never sync. Runs again until the first response stores an epoch; marking twice is harmless.
 */
export function prepareFirstSync(db: ArcanaDB): Promise<void> {
  return writeVerbatim(db, [...pushTables(db), db.meta], async () => {
    const epoch = await db.meta.get(EPOCH_KEY);
    const cursor = (await db.meta.get(CURSOR_KEY))?.value ?? '0';
    if (epoch !== undefined || cursor !== '0') return;
    for (const table of PUSH_ORDER) await markForPush(db, table);
  });
}

/**
 * Before a manual retry after `clock_ahead`: the flagged rows still carry the future
 * `updated_at` the wrong clock gave them, which the server would refuse forever. Re-stamps
 * them to the device's time now (still pending), if that is earlier. The server never accepted
 * the future version, so nothing that was synced moves backwards.
 */
export function restampClockAhead(db: ArcanaDB, errors: readonly SyncError[], now: IsoDateTime) {
  return writeVerbatim(db, pushTables(db), async () => {
    for (const error of errors) {
      if (error.code !== 'clock_ahead' || error.id === null || !isPushable(error.table)) continue;
      const rows = db.table<SyncedRow, string>(error.table);
      const row = await rows.get(error.id);
      if (row?.pending !== 1 || row.updated_at <= now) continue;
      const deletedAt = row.deleted_at === row.updated_at ? now : row.deleted_at;
      await rows.put({ ...row, updated_at: now, deleted_at: deletedAt });
    }
  });
}
