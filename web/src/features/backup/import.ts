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
// - when a newer file row overwrites a pending (never pushed) local row, each free-text field
//   whose local value differs is kept as a conflict row with the local value as the loser,
//   under the server's deterministic id, so the text she typed is never silently lost.
//
// A file is validated whole (`parseBackup`) before anything is read, and written in one
// transaction that checks foreign keys against the file and this device first: a failure
// anywhere leaves the database as it was.

import { v5 as uuidv5 } from 'uuid';

import {
  getDeviceId,
  nowIso,
  writeVerbatim,
  type ArcanaDB,
  type Conflict,
  type SyncedTables,
} from '../../db';
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

/** Last-write-wins keeps the losing value of these as a conflict row (sync rule 2). */
const FREE_TEXT_FIELDS: Partial<Record<BackupTable, readonly string[]>> = {
  client: ['notes'],
  session: ['notes', 'follow_up_note'],
  payment: ['note'],
  card_draw: ['note'],
  card_note: ['note'],
};

// Must match CONFLICT_ID_NAMESPACE in api/sync/service.py, and never change: conflict ids are
// UUIDv5s under it, so the same loss always gets the same id, here and on the server.
const CONFLICT_ID_NAMESPACE = '6f1c2a52-3d0e-4d8b-9a57-7c0f3e1b2d94';

/** The conflict id scheme of specs/plan.md ("Conflict rows"), the same as the server's. */
export function conflictId(
  table: BackupTable,
  recordId: string,
  field: string,
  losingUpdatedAt: string,
  losingDeviceId: string,
): string {
  const timestamp = new Date(losingUpdatedAt).toISOString();
  return uuidv5(
    `${table}:${recordId}:${field}:${timestamp}:${losingDeviceId}`,
    CONFLICT_ID_NAMESPACE,
  );
}

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
    // Read before the transaction, whose scope lacks `meta`. It already exists: the seed loader
    // creates it at startup.
    const deviceId = await getDeviceId(db);
    // writeVerbatim: the monotonic middleware would otherwise move `updated_at` past the
    // local row's, and last-write-wins on the next push would compare the wrong times.
    const counts = await writeVerbatim(db, allTables(db), async () => {
      const plan = await planImport(db, backup, deviceId);
      if (plan.missingParents > 0) {
        throw new ImportAborted({ kind: 'missingParent', count: plan.missingParents });
      }
      for (const { table, rows } of plan.writes) {
        if (rows.length > 0) await db.table(table).bulkPut(rows);
      }
      if (plan.conflicts.length > 0) await db.conflict.bulkAdd(plan.conflicts);
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
  /** New conflict rows for overwritten pending text; not counted, she sees them as conflicts. */
  conflicts: Conflict[];
  missingParents: number;
}

/** A pending local row the import overwrites. */
interface Overwrite {
  table: BackupTable;
  local: Record<string, unknown> & { id: string; updated_at: string; device_id: string };
  written: Record<string, unknown>;
}

/**
 * Decides every row against the stored ones, inside the caller's transaction. Its reads are
 * awaited right here, one level below the transaction scope, which Dexie keeps the transaction
 * alive across (a deeper chain of native awaits would let it commit early). Conflict rows are
 * only built with a `deviceId`, which only the import passes: the preview writes nothing.
 */
async function planImport(db: ArcanaDB, backup: Backup, deviceId?: string): Promise<Plan> {
  const counts: ImportCounts = { added: 0, updated: 0, deleted: 0, kept: 0, unchanged: 0 };
  const writes: Plan['writes'] = [];
  const overwrites: Overwrite[] = [];
  for (const table of BACKUP_TABLES) {
    const incoming = backup.tables[table];
    const stored: unknown[] = await db.table(table).bulkGet(incoming.map((row) => row.id));
    writes.push({ table, rows: planTable(table, incoming, stored, counts, overwrites) });
  }

  let conflicts: Conflict[] = [];
  if (deviceId !== undefined) {
    const candidates = lostText(overwrites, deviceId);
    // Insert only if absent, so a re-import never duplicates or reopens one, and never on top
    // of a conflict row the file itself writes.
    const fromFile = new Set(backup.tables.conflict.map((row) => row.id));
    const existing = await db.conflict.bulkGet(candidates.map((row) => row.id));
    conflicts = candidates.filter((row, i) => existing[i] === undefined && !fromFile.has(row.id));
  }

  let missingParents = 0;
  for (const ref of parentsOutsideFile(backup.tables)) {
    // A tombstoned parent counts: the server accepts children of deleted rows.
    if ((await db.table(ref.parentTable).get(ref.parentId)) === undefined) missingParents++;
  }
  return { counts, writes, conflicts, missingParents };
}

/** A conflict row per free-text field whose pending local value the import overwrites. */
function lostText(overwrites: Overwrite[], deviceId: string): Conflict[] {
  const now = nowIso();
  const conflicts: Conflict[] = [];
  for (const { table, local, written } of overwrites) {
    for (const field of FREE_TEXT_FIELDS[table] ?? []) {
      const losing = local[field] as string | null;
      if (losing === written[field]) continue;
      conflicts.push({
        id: conflictId(table, local.id, field, local.updated_at, local.device_id),
        updated_at: now,
        deleted_at: null,
        device_id: deviceId,
        pending: 1,
        server_version: null,
        table,
        record_id: local.id,
        field,
        losing_value: losing,
        losing_device_id: local.device_id,
        created_at: now,
        resolved: false,
      });
    }
  }
  return conflicts;
}

function planTable<T extends BackupTable>(
  table: T,
  incoming: BackupRow<T>[],
  stored: unknown[],
  counts: ImportCounts,
  overwrites: Overwrite[],
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
      if (local?.pending === 1) {
        overwrites.push({ table, local, written: candidate } as unknown as Overwrite);
      }
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
