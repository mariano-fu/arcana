// Resolving a conflict (T3.7). Everything goes through the normal local-write path: the record
// and the conflict rows are written with `pending = 1` in one transaction, and the updated_at
// middleware makes each write later than the version it replaces, even when this device's
// clock is behind the server that created the conflict. The next sync pushes both, and the
// server's last-write-wins applies them. Conflict rows are never hard-deleted: a resolved one
// is marked `resolved` and tombstoned.

import {
  createRepositories,
  getDeviceId,
  nowIso,
  type ArcanaDB,
  type Clock,
  type SyncedRow,
  type SyncedTableName,
} from '../../db';
import { isFreeText } from './conflicts';

export type Resolution =
  /** Keep the row as it is now. */
  | { kind: 'keep' }
  /** Write this text into the field: another version, or her combination of them. */
  | { kind: 'write'; text: string }
  /** The row was deleted: just drop the conflict. */
  | { kind: 'discard' };

export interface ConflictTarget {
  table: SyncedTableName;
  recordId: string;
  field: string;
  /** Every conflict row of that field: one decision resolves them all. */
  conflictIds: readonly string[];
}

export class ConflictNotWritableError extends Error {
  constructor(target: ConflictTarget) {
    super(`${target.table}.${target.field} (${target.recordId}) can't be written from a conflict`);
    this.name = 'ConflictNotWritableError';
  }
}

export async function resolveConflict(
  db: ArcanaDB,
  target: ConflictTarget,
  resolution: Resolution,
  clock: Clock = nowIso,
): Promise<void> {
  const deviceId = await getDeviceId(db);
  const records = db.table<SyncedRow, string>(target.table);
  await db.transaction('rw', [records, db.conflict], async () => {
    if (resolution.kind === 'write') {
      const record = await records.get(target.recordId);
      if (!record || record.deleted_at !== null || !isFreeText(target.table, target.field)) {
        throw new ConflictNotWritableError(target);
      }
      await records.put({
        ...record,
        [target.field]: resolution.text,
        updated_at: clock(),
        device_id: deviceId,
        pending: 1,
      });
    }
    for (const id of target.conflictIds) {
      const conflict = await db.conflict.get(id);
      if (!conflict || conflict.resolved || conflict.deleted_at !== null) continue;
      const now = clock();
      await db.conflict.put({
        ...conflict,
        resolved: true,
        deleted_at: now,
        updated_at: now,
        device_id: deviceId,
        pending: 1,
      });
    }
  });
}

/** "Restaurar la ficha": brings the deleted client back. Its other deleted sessions stay deleted. */
export async function restoreClient(
  db: ArcanaDB,
  clientId: string,
  clock: Clock = nowIso,
): Promise<void> {
  await createRepositories(db, clock).client.restore(clientId);
}

/** The prefilled "Combinar" text: the current version, then each other one, a blank line apart. */
export function combinedText(current: string, others: readonly (string | null)[]): string {
  return [current, ...others.map((text) => text ?? '')]
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}
