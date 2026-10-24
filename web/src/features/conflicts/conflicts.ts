// What "Conflictos" shows (T3.7, specs/plan.md "Client rules"). The server keeps the losing
// text of a free-text field as a `conflict` row when two devices edited it; here those rows
// are grouped per field, with the row they belong to and where it lives in the app.

import type {
  ArcanaDB,
  Conflict,
  IsoDate,
  IsoDateTime,
  SyncedRow,
  SyncedTableName,
} from '../../db';
import { findOrphanSessions, type OrphanSession } from './orphans';

/** The fields the server records conflicts for (api/sync/service.py FREE_TEXT_FIELDS). */
export const FREE_TEXT_FIELDS: Partial<Record<SyncedTableName, readonly string[]>> = {
  client: ['notes'],
  session: ['notes', 'follow_up_note'],
  payment: ['note'],
  card_draw: ['note'],
  card_note: ['note'],
};

/** Free text can be combined; anything else (never sent today) only keeps the current value. */
export function isFreeText(table: SyncedTableName, field: string): boolean {
  return FREE_TEXT_FIELDS[table]?.includes(field) ?? false;
}

/** Where the conflicting text lives, for its label and link. */
export type ConflictContext =
  | { kind: 'client'; clientId: string; clientName: string | null }
  | {
      kind: 'session';
      sessionId: string;
      clientName: string | null;
      startedAt: IsoDateTime | null;
    }
  | { kind: 'payment'; clientId: string | null; clientName: string | null; paidAt: IsoDate | null }
  | { kind: 'card_draw'; sessionId: string | null; cardId: string | null }
  | { kind: 'card_note'; cardId: string | null }
  | { kind: 'other' };

export interface ConflictGroup {
  /** `table:record_id:field`. */
  key: string;
  table: SyncedTableName;
  recordId: string;
  field: string;
  /** Its unresolved conflict rows, newest first. */
  conflicts: Conflict[];
  /** `live`: can be resolved. `deleted`: the row was deleted since; copy or discard only.
   *  `missing`: the row hasn't synced to this device yet; nothing to do until it does. */
  state: 'live' | 'deleted' | 'missing';
  /** The field's value in the row now, or null if the row isn't live. */
  current: string | null;
  freeText: boolean;
  context: ConflictContext;
}

export interface Review {
  groups: ConflictGroup[];
  orphans: OrphanSession[];
  /** What needs her: every group but `missing` ones, plus every orphan. */
  count: number;
}

const isOpen = (conflict: Conflict) => !conflict.resolved && conflict.deleted_at === null;

/** A row's field by name, for the conflict's `field`. */
export function fieldValue(row: object, field: string): unknown {
  const value: unknown = Object.getOwnPropertyDescriptor(row, field)?.value;
  return value;
}

/** A field shown as text: strings as they are, numbers and booleans spelled out, else null. */
const asText = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

export async function loadReview(db: ArcanaDB): Promise<Review> {
  const open = (await db.conflict.toArray()).filter(isOpen);
  const byField = new Map<string, Conflict[]>();
  for (const conflict of open) {
    const key = `${conflict.table}:${conflict.record_id}:${conflict.field}`;
    byField.set(key, [...(byField.get(key) ?? []), conflict]);
  }

  const groups: ConflictGroup[] = [];
  for (const [key, conflicts] of byField) {
    const first = conflicts[0];
    if (!first) continue;
    conflicts.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const record = await db.table<SyncedRow, string>(first.table).get(first.record_id);
    const state = !record ? 'missing' : record.deleted_at === null ? 'live' : 'deleted';
    groups.push({
      key,
      table: first.table,
      recordId: first.record_id,
      field: first.field,
      conflicts,
      state,
      current: record && state === 'live' ? (asText(fieldValue(record, first.field)) ?? '') : null,
      freeText: isFreeText(first.table, first.field),
      context: record ? await contextOf(db, first.table, record) : { kind: 'other' },
    });
  }
  groups.sort((a, b) =>
    (b.conflicts[0]?.created_at ?? '').localeCompare(a.conflicts[0]?.created_at ?? ''),
  );

  const orphans = await findOrphanSessions(db);
  const count = groups.filter((group) => group.state !== 'missing').length + orphans.length;
  return { groups, orphans, count };
}

async function clientName(db: ArcanaDB, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await db.client.get(id))?.name ?? null;
}

async function contextOf(
  db: ArcanaDB,
  table: SyncedTableName,
  record: SyncedRow,
): Promise<ConflictContext> {
  const text = (field: string) => asText(fieldValue(record, field));
  switch (table) {
    case 'client':
      return { kind: 'client', clientId: record.id, clientName: text('name') };
    case 'session':
      return {
        kind: 'session',
        sessionId: record.id,
        clientName: await clientName(db, text('client_id')),
        startedAt: text('started_at'),
      };
    case 'payment':
      return {
        kind: 'payment',
        clientId: text('client_id'),
        clientName: await clientName(db, text('client_id')),
        paidAt: text('paid_at'),
      };
    case 'card_draw': {
      const readingId = text('reading_id');
      const reading = readingId ? await db.reading.get(readingId) : undefined;
      return { kind: 'card_draw', sessionId: reading?.session_id ?? null, cardId: text('card_id') };
    }
    case 'card_note':
      return { kind: 'card_note', cardId: text('card_id') };
    default:
      return { kind: 'other' };
  }
}

/** The page the conflicting text is edited on, if it has one. */
export function linkTo(context: ConflictContext): string | null {
  switch (context.kind) {
    case 'client':
      return `/clients/${context.clientId}`;
    case 'session':
      return `/sessions/${context.sessionId}`;
    case 'payment':
      return context.clientId ? `/clients/${context.clientId}` : null;
    case 'card_draw':
      return context.sessionId ? `/sessions/${context.sessionId}` : null;
    case 'card_note':
      return context.cardId ? `/cards/${context.cardId}` : null;
    case 'other':
      return null;
  }
}
