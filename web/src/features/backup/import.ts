// Import (T1.13): merges a backup into this device, empty or not (specs/plan.md, "Export /
// import"). Ids are kept, so nothing is ever duplicated. Per row, by `updated_at`:
// - no local row → stored; newer → overwrites; older → the local row stays;
// - equal: identical content is skipped, different content keeps the local row (the server's
//   rule: the stored row wins a tie);
// - untouched seed rows in the file are skipped (this device's bundle owns them), and an edited
//   seed row always replaces an untouched local one, whose `updated_at` is only the loader's.
// Written rows keep `updated_at` and `deleted_at` exactly as in the file and are marked
// `pending = 1`, so sync pushes them and the server's last-write-wins has the last word. The
// cursor, epoch and device id are never touched.
//
// A file is validated whole (`parseBackup`) before anything is read, and written in one
// transaction that checks foreign keys against the file and this device first: a failure
// anywhere leaves the database as it was.

import { writeVerbatim, type ArcanaDB, type SyncedTables } from '../../db';
import { isUntouchedSeedRow } from '../../seed/loader';
import {
  BACKUP_TABLES,
  parseBackup,
  parentsOutsideFile,
  type Backup,
  type BackupProblem,
  type BackupRow,
  type BackupTable,
  type ParsedBackup,
} from './format';

/** Larger files are refused unread. Her data is well under 1 MB. */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

/** Rows dated further ahead than this are flagged: the server refuses them as `clock_ahead`. */
const CLOCK_AHEAD_MS = 24 * 60 * 60_000;

/**
 * What an import does, by what she would notice:
 * - `added`: a record appears (new, or a deleted one comes back);
 * - `updated`: a record changes;
 * - `deleted`: a record disappears;
 * - `kept`: this device's version is newer (or won a tie) and stays;
 * - `unchanged`: nothing visible: identical rows, untouched seed rows, and deletions of records
 *   this device doesn't have, which are still stored so sync knows about them.
 */
export interface ImportCounts {
  added: number;
  updated: number;
  deleted: number;
  kept: number;
  unchanged: number;
}

export type ImportPreview =
  | { ok: true; counts: ImportCounts; exportedAt: string; futureRows: number }
  | { ok: false; problem: BackupProblem };

export type ImportResult =
  { ok: true; counts: ImportCounts } | { ok: false; problem: BackupProblem };

/** Reads a picked file and validates it. Never throws. */
export async function readBackupFile(file: Pick<Blob, 'size' | 'text'>): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, problem: { kind: 'tooLarge' } };
  try {
    return parseBackup(await file.text());
  } catch (error) {
    console.error('Backup file not read', error);
    return { ok: false, problem: { kind: 'notJson' } };
  }
}

const allTables = (db: ArcanaDB) => BACKUP_TABLES.map((table) => db.table(table));

/** What the import would do, without writing. The import itself works it out again. */
export async function previewImport(
  db: ArcanaDB,
  backup: Backup,
  now: Date = new Date(),
): Promise<ImportPreview> {
  try {
    const plan = await db.transaction('r', allTables(db), () => planImport(db, backup));
    if (plan.missingParents > 0) {
      return { ok: false, problem: { kind: 'missingParent', count: plan.missingParents } };
    }
    return {
      ok: true,
      counts: plan.counts,
      exportedAt: backup.exported_at,
      futureRows: futureRows(backup, now),
    };
  } catch (error) {
    console.error('Import preview failed', error);
    return { ok: false, problem: { kind: 'failed' } };
  }
}

class ImportAborted extends Error {
  constructor(readonly problem: BackupProblem) {
    super(problem.kind);
    this.name = 'ImportAborted';
  }
}

/**
 * Merges the backup in one transaction: decides every row against the rows stored now, checks
 * foreign keys, then writes. Any failure rolls the whole transaction back. The counts are the
 * ones of this transaction, not of an earlier preview.
 */
export async function applyImport(db: ArcanaDB, backup: Backup): Promise<ImportResult> {
  try {
    // writeVerbatim: the monotonic middleware would otherwise move `updated_at` past the
    // local row's, and last-write-wins on the next push would compare the wrong times.
    const counts = await writeVerbatim(db, allTables(db), async () => {
      const plan = await planImport(db, backup);
      if (plan.missingParents > 0) {
        throw new ImportAborted({ kind: 'missingParent', count: plan.missingParents });
      }
      for (const { table, rows } of plan.writes) {
        if (rows.length > 0) await db.table(table).bulkPut(rows);
      }
      return plan.counts;
    });
    return { ok: true, counts };
  } catch (error) {
    if (error instanceof ImportAborted) return { ok: false, problem: error.problem };
    console.error('Import failed', error);
    return { ok: false, problem: { kind: 'failed' } };
  }
}

/** Rows whose `updated_at` is more than 24 h ahead of this device's clock. */
export function futureRows(backup: Backup, now: Date): number {
  const limit = new Date(now.getTime() + CLOCK_AHEAD_MS).toISOString();
  let count = 0;
  for (const table of BACKUP_TABLES) {
    for (const row of backup.tables[table]) if (row.updated_at > limit) count++;
  }
  return count;
}

interface Plan {
  counts: ImportCounts;
  writes: { table: BackupTable; rows: unknown[] }[];
  missingParents: number;
}

/**
 * Decides every row against the stored ones, inside the caller's transaction. Its reads are
 * awaited right here, one level below the transaction scope, which Dexie keeps the transaction
 * alive across (a deeper chain of native awaits would let it commit early).
 */
async function planImport(db: ArcanaDB, backup: Backup): Promise<Plan> {
  const counts: ImportCounts = { added: 0, updated: 0, deleted: 0, kept: 0, unchanged: 0 };
  const writes: Plan['writes'] = [];
  for (const table of BACKUP_TABLES) {
    const incoming = backup.tables[table];
    const stored: unknown[] = await db.table(table).bulkGet(incoming.map((row) => row.id));
    writes.push({ table, rows: planTable(table, incoming, stored, counts) });
  }

  let missingParents = 0;
  for (const ref of parentsOutsideFile(backup.tables)) {
    // A tombstoned parent counts: the server accepts children of deleted rows.
    if ((await db.table(ref.parentTable).get(ref.parentId)) === undefined) missingParents++;
  }
  return { counts, writes, missingParents };
}

function planTable<T extends BackupTable>(
  table: T,
  incoming: BackupRow<T>[],
  stored: unknown[],
  counts: ImportCounts,
): SyncedTables[T][] {
  const writes: SyncedTables[T][] = [];
  incoming.forEach((row, i) => {
    const local = stored[i] as SyncedTables[T] | undefined;
    const candidate = {
      ...row,
      pending: 1,
      server_version: local?.server_version ?? row.server_version,
    } as SyncedTables[T];
    const outcome = decide(table, candidate, local);
    if (outcome === 'write') {
      writes.push(candidate);
      counts[effect(candidate, local)]++;
    } else {
      counts[outcome]++;
    }
  });
  return writes;
}

const isUntouchedSeed: { [T in BackupTable]: (row: SyncedTables[T]) => boolean } = {
  ...isUntouchedSeedRow,
  client: () => false,
  session: () => false,
  payment: () => false,
  reading: () => false,
  card_draw: () => false,
  card_note: () => false,
  conflict: () => false,
};

function untouchedSeed<T extends BackupTable>(table: T, row: SyncedTables[T]): boolean {
  return isUntouchedSeed[table](row);
}

function decide<T extends BackupTable>(
  table: T,
  incoming: SyncedTables[T],
  local: SyncedTables[T] | undefined,
): 'write' | 'kept' | 'unchanged' {
  if (untouchedSeed(table, incoming)) return 'unchanged';
  if (local === undefined) return 'write';
  // Her edit beats the bundle: the loader stamps untouched seed rows when it loads them.
  if (untouchedSeed(table, local)) return 'write';
  if (incoming.updated_at > local.updated_at) return 'write';
  if (incoming.updated_at < local.updated_at) return 'kept';
  return sameContent(incoming, local) ? 'unchanged' : 'kept';
}

function effect(
  written: { deleted_at: string | null },
  local: { deleted_at: string | null } | undefined,
): 'added' | 'updated' | 'deleted' | 'unchanged' {
  const wasLive = local !== undefined && local.deleted_at === null;
  if (written.deleted_at === null) return wasLive ? 'updated' : 'added';
  return wasLive ? 'deleted' : 'unchanged';
}

/** Equal apart from sync bookkeeping (`pending`, `server_version`, `device_id`). */
function sameContent(a: object, b: object): boolean {
  return canonical(a) === canonical(b);
}

const IGNORED = new Set(['pending', 'server_version', 'device_id']);

function canonical(row: object): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  const fields = Object.fromEntries(Object.entries(row).filter(([key]) => !IGNORED.has(key)));
  return JSON.stringify(sorted(fields));
}
