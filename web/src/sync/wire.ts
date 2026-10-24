// Local rows ↔ sync records. The conversions are spelled out per table so the type checker
// matches each local row type against its generated record type (see api-types.test.ts).

import type { SyncedRow, SyncedTableName, SyncedTables } from '../db';
import type { PulledChange, PushChange } from './api';

export type PushableTable = PushChange['table'];

/**
 * Parents before children. The server checks foreign keys per request, so a chunk must never
 * hold a child whose parent is still waiting in a later chunk.
 */
export const PUSH_ORDER: readonly PushableTable[] = [
  'client',
  'spread_template',
  'crystal',
  'intention_tag',
  'card_note',
  'session',
  'session_crystal',
  'payment',
  'reading',
  'card_draw',
  'conflict',
];

export const SYNCED_TABLES: readonly SyncedTableName[] = [...PUSH_ORDER, 'horoscope'];

export function isPushable(table: string | null): table is PushableTable {
  return PUSH_ORDER.some((name) => name === table);
}

type PushChangeOf<T extends PushableTable> = Extract<PushChange, { table: T }>;
export type PulledRecordOf<T extends SyncedTableName> = Extract<
  PulledChange,
  { table: T }
>['record'];

/** The row as it is pushed: without the local-only `pending` and the server's `server_version`. */
function wire<R extends SyncedRow>(row: R): Omit<R, 'pending' | 'server_version'> {
  const { pending, server_version, ...record } = row;
  return record;
}

const pushers: { [T in PushableTable]: (row: SyncedTables[T]) => PushChangeOf<T> } = {
  client: (row) => ({ table: 'client', record: wire(row) }),
  session: (row) => ({ table: 'session', record: wire(row) }),
  payment: (row) => ({ table: 'payment', record: wire(row) }),
  reading: (row) => ({ table: 'reading', record: wire(row) }),
  card_draw: (row) => ({ table: 'card_draw', record: wire(row) }),
  spread_template: (row) => ({ table: 'spread_template', record: wire(row) }),
  crystal: (row) => ({ table: 'crystal', record: wire(row) }),
  intention_tag: (row) => ({ table: 'intention_tag', record: wire(row) }),
  card_note: (row) => ({ table: 'card_note', record: wire(row) }),
  session_crystal: (row) => ({ table: 'session_crystal', record: wire(row) }),
  conflict: (row) => ({ table: 'conflict', record: wire(row) }),
};

export function toPushChange<T extends PushableTable>(
  table: T,
  row: SyncedTables[T],
): PushChangeOf<T> {
  return pushers[table](row);
}

/** A pulled record as stored locally: the server's row, with nothing left to push. */
const pullers: { [T in SyncedTableName]: (record: PulledRecordOf<T>) => SyncedTables[T] } = {
  client: (record) => ({ ...record, pending: 0 }),
  session: (record) => ({ ...record, pending: 0 }),
  payment: (record) => ({ ...record, pending: 0 }),
  reading: (record) => ({ ...record, pending: 0 }),
  card_draw: (record) => ({ ...record, pending: 0 }),
  spread_template: (record) => ({ ...record, pending: 0 }),
  crystal: (record) => ({ ...record, pending: 0 }),
  intention_tag: (record) => ({ ...record, pending: 0 }),
  card_note: (record) => ({ ...record, pending: 0 }),
  session_crystal: (record) => ({ ...record, pending: 0 }),
  conflict: (record) => ({ ...record, pending: 0 }),
  horoscope: (record) => ({ ...record, pending: 0 }),
};

export function fromPulled<T extends SyncedTableName>(
  table: T,
  record: PulledRecordOf<T>,
): SyncedTables[T] {
  return pullers[table](record);
}
