// Export (T1.13): every row of every backup table, live and tombstoned, in one JSON file.
//
// The file is read ahead (`readBackup`, through a live query in Ajustes) so that the tap only
// stamps the date, serializes and checks it: iOS opens the share sheet only straight from the
// tap, with nothing awaited before it. Left out on purpose: the JWTs (`auth`), this device's
// sync cursor, epoch and status, its seed versions as data, and horoscopes.

import type { ArcanaDB, SyncedTables } from '../../db';
import { SEED_VERSION_KEYS } from '../../seed/loader';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  FORMAT_VERSION,
  parseBackup,
  parentsOutsideFile,
  type Backup,
  type BackupProblem,
  type BackupRow,
  type BackupTable,
} from './format';

/** A backup without its export date, which is stamped at the tap. */
export type BackupDraft = Omit<Backup, 'exported_at'>;

async function rowsOf<T extends BackupTable>(db: ArcanaDB, table: T): Promise<BackupRow<T>[]> {
  const rows = await db.table<SyncedTables[T], string>(table).toArray();
  return rows.map(({ pending, ...row }) => row);
}

/** Reads the whole backup in one transaction, so it is a consistent snapshot. Read-only. */
export function readBackup(db: ArcanaDB, appVersion: string): Promise<BackupDraft> {
  const tables = [...BACKUP_TABLES.map((table) => db.table(table)), db.meta];
  return db.transaction('r', tables, async () => {
    const meta = async (key: string) => (await db.meta.get(key))?.value;
    const seedVersion = async (key: string) => {
      const value = await meta(key);
      return value === undefined ? null : Number(value);
    };
    return {
      format: BACKUP_FORMAT,
      format_version: FORMAT_VERSION,
      db_schema_version: db.verno,
      app_version: appVersion,
      device_id: (await meta('device_id')) ?? null,
      seed_versions: {
        spreads: await seedVersion(SEED_VERSION_KEYS.spreads),
        crystals: await seedVersion(SEED_VERSION_KEYS.crystals),
      },
      tables: {
        client: await rowsOf(db, 'client'),
        spread_template: await rowsOf(db, 'spread_template'),
        crystal: await rowsOf(db, 'crystal'),
        intention_tag: await rowsOf(db, 'intention_tag'),
        card_note: await rowsOf(db, 'card_note'),
        session: await rowsOf(db, 'session'),
        session_crystal: await rowsOf(db, 'session_crystal'),
        payment: await rowsOf(db, 'payment'),
        reading: await rowsOf(db, 'reading'),
        card_draw: await rowsOf(db, 'card_draw'),
        conflict: await rowsOf(db, 'conflict'),
      },
    };
  });
}

export type ExportFile =
  /** `date` is the local date for the file name (`settings.backup.filename`). */
  { ok: true; date: string; text: string } | { ok: false; problem: BackupProblem };

/**
 * The file to share, checked by the import validator first: a file this device couldn't import
 * back is never handed out as a backup. Synchronous, so it can run inside the tap.
 */
export function toExportFile(draft: BackupDraft, now: Date): ExportFile {
  const backup: Backup = { ...draft, exported_at: now.toISOString() };
  const text = JSON.stringify(backup, null, 2);
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const orphans = parentsOutsideFile(parsed.backup.tables);
  if (orphans.length > 0) {
    console.warn(
      'Export has rows whose parent is missing',
      orphans.map(({ table, id }) => ({ table, id })),
    );
    return { ok: false, problem: { kind: 'missingParent', count: orphans.length } };
  }
  return { ok: true, date: localDate(now), text };
}

/** `2026-10-21`: the device's local calendar date. */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
