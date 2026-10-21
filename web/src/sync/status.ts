// Sync state kept in `meta`, so the UI (and the next run) can read it after a reload. Whether a
// run is in progress is held in memory only (`SyncEngine.syncing`): a crash mid-run can't leave
// a stale "syncing" behind.

import { z } from 'zod';

import type { ArcanaDB } from '../db';

export const STATUS_KEY = 'sync:status';
/** Last `server_version` applied locally (the pull cursor), as a decimal string. */
export const CURSOR_KEY = 'sync:cursor';
/** The server database's epoch the cursor refers to. */
export const EPOCH_KEY = 'sync:epoch';

export const SYNC_STATES = [
  /** The last run finished, or none has run yet. */
  'idle',
  /** The server refused a push (400): automatic runs pause until a manual "Sincronizar". */
  'stopped',
  /** A 400 because the device clock is ahead: "Revise la fecha y hora del teléfono". */
  'clock_ahead',
  /** The refresh token was refused: log in again in Settings. Local data is untouched. */
  'session_expired',
  /** Never logged in on this device. */
  'signed_out',
  /** No connection. The next trigger tries again. */
  'offline',
  /** Server error or throttled. The next trigger tries again. */
  'error',
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

/** Automatic triggers skip these; only a manual run (one per tap) tries again. */
export const PAUSED_STATES: ReadonlySet<SyncState> = new Set([
  'stopped',
  'clock_ahead',
  'session_expired',
]);

const syncErrorSchema = z.object({
  table: z.string().nullable(),
  id: z.string().nullable(),
  code: z.string(),
  detail: z.string(),
});

const statusSchema = z.object({
  state: z.enum(SYNC_STATES),
  /** When a run last completed. */
  last_success: z.string().nullable(),
  /** Server clock minus device clock at the last response; for the skew warning (T3.8). */
  clock_skew_ms: z.number().nullable(),
  /** Why the server refused the last push (`stopped`, `clock_ahead`). */
  errors: z.array(syncErrorSchema),
});

export type SyncError = z.infer<typeof syncErrorSchema>;
export type SyncStatus = z.infer<typeof statusSchema>;

export const INITIAL_STATUS: SyncStatus = {
  state: 'idle',
  last_success: null,
  clock_skew_ms: null,
  errors: [],
};

export function parseStatus(value: string | undefined): SyncStatus {
  if (value === undefined) return INITIAL_STATUS;
  try {
    const result = statusSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : INITIAL_STATUS;
  } catch {
    return INITIAL_STATUS;
  }
}

export async function readStatus(db: ArcanaDB): Promise<SyncStatus> {
  return parseStatus((await db.meta.get(STATUS_KEY))?.value);
}

export async function writeStatus(db: ArcanaDB, status: SyncStatus): Promise<void> {
  await db.meta.put({ key: STATUS_KEY, value: JSON.stringify(status) });
}

export async function readCursor(db: ArcanaDB): Promise<number> {
  const value = Number((await db.meta.get(CURSOR_KEY))?.value ?? '0');
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
