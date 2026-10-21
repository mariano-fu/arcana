// Strictly increasing `updated_at` per row (specs/plan.md, "Client rules").
//
// Last-write-wins compares `updated_at`, so every local edit must be later than the version it
// replaces, even when the device clock reads the same millisecond twice or is behind the
// version it is editing (a row pulled from a device or server with a later clock). A DBCore
// middleware enforces it for every writer at once: each `put` of a row with `pending = 1`
// that replaces a stored row gets `updated_at = max(given, previous + 1 ms)`. Writes with
// `pending = 0` (seed rows, rows pulled by sync) are stored as given.

import type { DBCore, DBCoreMutateRequest, DBCoreTable, Dexie, Middleware, Table } from 'dexie';

import type { IsoDateTime } from './types';

/** `max(given, previous + 1 ms)`. ISO timestamps of one width compare as strings. */
export function nextUpdatedAt(given: IsoDateTime, previous: IsoDateTime | undefined): IsoDateTime {
  if (previous === undefined) return given;
  const bumped = new Date(Date.parse(previous) + 1).toISOString();
  return given > bumped ? given : bumped;
}

interface StampedValue {
  updated_at: IsoDateTime;
  deleted_at?: IsoDateTime | null;
  pending: 0 | 1;
}

function isPendingStamp(value: unknown): value is StampedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pending' in value &&
    value.pending === 1 &&
    'updated_at' in value &&
    typeof value.updated_at === 'string'
  );
}

/** Transactions opened by `writeVerbatim`; the middleware leaves their writes alone. */
const verbatim = new WeakSet();

/** Notified after every local edit (a `pending = 1` write outside `writeVerbatim`). */
export type LocalWriteListener = () => void;

export function monotonicUpdatedAt(onLocalWrite: LocalWriteListener): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'monotonicUpdatedAt',
    create(down) {
      return {
        ...down,
        table(name) {
          const table = down.table(name);
          return { ...table, mutate: (req) => mutate(table, req, onLocalWrite) };
        },
      };
    },
  };
}

async function mutate(
  table: DBCoreTable,
  req: DBCoreMutateRequest,
  onLocalWrite: LocalWriteListener,
) {
  if ((req.type !== 'put' && req.type !== 'add') || verbatim.has(req.trans)) {
    return table.mutate(req);
  }
  const stamped = req.values.filter(isPendingStamp);
  if (stamped.length === 0) return table.mutate(req);

  if (req.type === 'put') {
    const keys = stamped.map((value): unknown => {
      const key: unknown = table.schema.primaryKey.extractKey?.(value);
      return key;
    });
    const previous: unknown[] = await table.getMany({ trans: req.trans, keys });
    stamped.forEach((value, i) => {
      const stored = previous[i];
      if (!isStored(stored)) return;
      const next = nextUpdatedAt(value.updated_at, stored.updated_at);
      // A tombstone is stamped with deleted_at = updated_at; keep them equal.
      if (value.deleted_at === value.updated_at) value.deleted_at = next;
      value.updated_at = next;
    });
  }
  const result = await table.mutate(req);
  onLocalWrite();
  return result;
}

function isStored(value: unknown): value is { updated_at: IsoDateTime } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'updated_at' in value &&
    typeof value.updated_at === 'string'
  );
}

/**
 * Runs `scope` in a new read-write transaction whose writes keep `updated_at` exactly as given.
 *
 * The one narrow exception to the strictly increasing rule, used only by the sync engine:
 * marking rows pending for a full re-push after a server epoch change (their real edit times
 * must survive, so last-write-wins compares them), and re-stamping rows the server refused as
 * `clock_ahead` back to the device's corrected clock. Must not be called inside another
 * transaction, which it would share.
 */
export function writeVerbatim<T>(
  db: Dexie,
  tables: readonly Table[],
  scope: () => Promise<T>,
): Promise<T> {
  return db.transaction('rw', tables, (tx) => {
    verbatim.add(tx.idbtrans);
    return scope();
  });
}
