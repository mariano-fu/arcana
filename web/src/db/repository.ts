import type { Table } from 'dexie';

import type { ArcanaDB } from './db';
import { getDeviceId } from './device';
import { newId, nowIso } from './ids';
import type { IsoDateTime, SyncedRow } from './types';

type SystemField = keyof SyncedRow;

/** What callers provide when creating a row: everything except the sync columns. */
export type NewRow<T extends SyncedRow> = Omit<T, SystemField>;
export type RowPatch<T extends SyncedRow> = Partial<NewRow<T>>;

export interface ReadOptions {
  /** Include tombstoned rows. Default false. */
  includeDeleted?: boolean;
}

export interface ReadonlyRepository<T extends SyncedRow> {
  get(id: string, options?: ReadOptions): Promise<T | undefined>;
  list(options?: ReadOptions): Promise<T[]>;
}

export interface Repository<T extends SyncedRow> extends ReadonlyRepository<T> {
  create(data: NewRow<T>): Promise<T>;
  update(id: string, patch: RowPatch<T>): Promise<T>;
  /** Soft delete: sets `deleted_at` so the tombstone syncs to other devices. */
  remove(id: string): Promise<void>;
  /** Undoes a soft delete. The new `updated_at` beats the tombstone. No-op on a live row. */
  restore(id: string): Promise<T>;
  /** Rows with unsynced changes, tombstones included. */
  listPending(): Promise<T[]>;
}

export class RowNotFoundError extends Error {
  constructor(table: string, id: string) {
    super(`${table} row not found: ${id}`);
    this.name = 'RowNotFoundError';
  }
}

export type Clock = () => IsoDateTime;

export function createReadonlyRepository<T extends SyncedRow>(
  table: Table<T, string>,
): ReadonlyRepository<T> {
  return {
    async get(id, options = {}) {
      const row = await table.get(id);
      if (!row || (row.deleted_at !== null && !options.includeDeleted)) return undefined;
      return row;
    },
    async list(options = {}) {
      if (options.includeDeleted) return table.toArray();
      return table.filter((row) => row.deleted_at === null).toArray();
    },
  };
}

export function createRepository<T extends SyncedRow>(
  db: ArcanaDB,
  table: Table<T, string>,
  clock: Clock = nowIso,
): Repository<T> {
  // System fields are spread last so callers can never override them.
  async function stamp(): Promise<Pick<SyncedRow, 'updated_at' | 'device_id' | 'pending'>> {
    return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 };
  }

  async function getLive(id: string): Promise<T> {
    const row = await table.get(id);
    if (!row || row.deleted_at !== null) throw new RowNotFoundError(table.name, id);
    return row;
  }

  return {
    ...createReadonlyRepository(table),

    async create(data) {
      const row = {
        ...data,
        id: newId(),
        deleted_at: null,
        server_version: null,
        ...(await stamp()),
      } as T;
      await table.add(row);
      return row;
    },

    async update(id, patch) {
      const stamped = await stamp();
      return db.transaction('rw', table, async () => {
        const existing = await getLive(id);
        const row: T = {
          ...existing,
          ...patch,
          id: existing.id,
          deleted_at: existing.deleted_at,
          server_version: existing.server_version,
          ...stamped,
        };
        await table.put(row);
        return row;
      });
    },

    async remove(id) {
      const stamped = await stamp();
      await db.transaction('rw', table, async () => {
        const existing = await getLive(id);
        await table.put({ ...existing, ...stamped, deleted_at: stamped.updated_at });
      });
    },

    async restore(id) {
      const stamped = await stamp();
      return db.transaction('rw', table, async () => {
        const existing = await table.get(id);
        if (!existing) throw new RowNotFoundError(table.name, id);
        if (existing.deleted_at === null) return existing;
        const row: T = { ...existing, ...stamped, deleted_at: null };
        await table.put(row);
        return row;
      });
    },

    listPending() {
      return table.where('pending').equals(1).toArray();
    },
  };
}
