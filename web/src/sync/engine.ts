// The sync engine (specs/plan.md, "Sync protocol" and "Client rules"): push pending rows in
// chunks, apply each response, then pull pages until the cursor stops moving.
//
// One run at a time: within a tab a call during a run queues exactly one follow-up run, and
// across tabs runs take the `arcana:sync` Web Lock. Nothing here depends on background sync
// (iOS has none); runs start from the triggers in `triggers.ts`.

import { getDeviceId, nowIso, type ArcanaDB, type Clock } from '../db';
import type { Api, ApiResult, PushChange, SyncBadRequest, SyncRejected, SyncResponse } from './api';
import {
  applyResponse,
  NOTHING_PUSHED,
  prepareFirstSync,
  readPending,
  resetForEpoch,
  restampClockAhead,
  type PushSnapshot,
} from './apply';
import { createAuth, type Auth } from './auth';
import { chunkChanges, PUSH_LIMITS, type ChunkLimits } from './chunk';
import { defaultLocks, SYNC_LOCK, type Locks } from './locks';
import {
  EPOCH_KEY,
  INITIAL_STATUS,
  PAUSED_STATES,
  readCursor,
  readStatus,
  writeStatus,
  type SyncError,
  type SyncState,
  type SyncStatus,
} from './status';

export type SyncReason = 'open' | 'visible' | 'online' | 'interval' | 'local_write' | 'manual';

/** Pull pages per run. A longer backlog resumes from the saved cursor on the next run. */
export const MAX_PULL_PAGES = 200;
/** Server errors kept for the "detenida" details. */
const MAX_ERRORS = 50;

export interface SyncEngineOptions {
  db: ArcanaDB;
  api: Api;
  auth?: Auth;
  locks?: Locks;
  clock?: Clock;
  pushLimits?: ChunkLimits;
  maxPullPages?: number;
}

export interface SyncEngine {
  readonly auth: Auth;
  /**
   * Runs a sync and resolves with the resulting status. Automatic reasons do nothing while
   * sync is paused (`stopped`, `clock_ahead`, `session_expired`); `manual` always tries once.
   */
  sync(reason: SyncReason): Promise<SyncStatus>;
  /** Whether a run of this engine is in progress (memory only). */
  isSyncing: () => boolean;
  /** Called when a run starts or ends. Returns an unsubscribe. For `useSyncExternalStore`. */
  subscribe: (listener: () => void) => () => void;
}

type Step =
  | { kind: 'applied' }
  | { kind: 'done' }
  | { kind: 'epoch_reset' }
  | { kind: 'failed'; state: SyncState; errors: SyncError[] };

type Expired = { kind: 'expired' };

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { db, api } = options;
  const locks = options.locks ?? defaultLocks();
  const auth = options.auth ?? createAuth(db, api, locks);
  const clock = options.clock ?? nowIso;
  const pushLimits = options.pushLimits ?? PUSH_LIMITS;
  const maxPullPages = options.maxPullPages ?? MAX_PULL_PAGES;

  const listeners = new Set<() => void>();
  let running: Promise<SyncStatus> | null = null;
  let followUp: Promise<SyncStatus> | null = null;
  let followUpManual = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function start(manual: boolean): Promise<SyncStatus> {
    running = locks
      .request(SYNC_LOCK, () => runGuarded(manual))
      .finally(() => {
        running = null;
        notify();
      });
    notify();
    return running;
  }

  /** Never rejects: triggers fire and forget, and the follow-up chain must keep going. */
  async function runGuarded(manual: boolean): Promise<SyncStatus> {
    try {
      return await run(manual);
    } catch (error) {
      console.error('Sync failed', error);
      let status: SyncStatus = { ...INITIAL_STATUS, state: 'error' };
      try {
        status = { ...(await readStatus(db)), state: 'error', errors: [] };
        await writeStatus(db, status);
      } catch (statusError) {
        console.error('Sync status not saved', statusError);
      }
      return status;
    }
  }

  async function run(manual: boolean): Promise<SyncStatus> {
    const previous = await readStatus(db);
    if (!manual && PAUSED_STATES.has(previous.state)) return previous;

    let skew = previous.clock_skew_ms;
    const save = async (state: SyncState, errors: SyncError[] = []): Promise<SyncStatus> => {
      const status: SyncStatus = {
        state,
        errors,
        clock_skew_ms: skew,
        last_success: state === 'idle' ? clock() : previous.last_success,
      };
      await writeStatus(db, status);
      return status;
    };

    if ((await auth.getAccess()) === undefined) {
      return save(previous.state === 'session_expired' ? 'session_expired' : 'signed_out');
    }
    if (manual && previous.state === 'clock_ahead') {
      await restampClockAhead(db, previous.errors, clock());
    }
    await prepareFirstSync(db);
    const deviceId = await getDeviceId(db);

    async function exchange(changes: PushChange[], snapshot: PushSnapshot): Promise<Step> {
      const cursor = await readCursor(db);
      const sent = Date.parse(clock());
      const result = await withAuth((access) =>
        api.sync(access, { device_id: deviceId, cursor, changes }),
      );
      if (result.kind !== 'ok') return failed(result);

      const body: SyncResponse = result.body;
      skew = Math.round(Date.parse(body.server_time) - (sent + Date.parse(clock())) / 2);
      const stored = (await db.meta.get(EPOCH_KEY))?.value;
      if (stored !== undefined && stored !== body.epoch) {
        // The page belongs to another database than the cursor did: don't apply it.
        await resetForEpoch(db, body.epoch);
        return { kind: 'epoch_reset' };
      }
      await applyResponse(db, body, snapshot);
      return { kind: 'applied' };
    }

    async function pushAndPull(): Promise<Step> {
      const { changes, snapshot } = await readPending(db);
      for (const chunk of chunkChanges(changes, pushLimits)) {
        // Only this chunk's rows: a row still waiting in a later chunk hasn't been pushed, so a
        // server copy pulled now must not count as the server's answer to it.
        const step = await exchange(chunk, chunkSnapshot(chunk, snapshot));
        if (step.kind !== 'applied') return step;
      }
      for (let page = 0; page < maxPullPages; page++) {
        const before = await readCursor(db);
        const step = await exchange([], NOTHING_PUSHED);
        if (step.kind !== 'applied') return step;
        if ((await readCursor(db)) === before) break;
      }
      return { kind: 'done' };
    }

    // After an epoch reset, start over once: re-push everything, pull from cursor 0.
    for (let attempt = 0; attempt < 2; attempt++) {
      const step = await pushAndPull();
      if (step.kind === 'failed') return save(step.state, step.errors);
      if (step.kind === 'done') return save('idle');
    }
    return save('error'); // The epoch changed again within one run.
  }

  /** One call; after a 401, one refresh and one retry. A second 401 ends the session. */
  async function withAuth<T, Rejected>(
    call: (access: string) => Promise<ApiResult<T, Rejected>>,
  ): Promise<ApiResult<T, Rejected> | Expired> {
    const access = await auth.getAccess();
    if (access === undefined) return { kind: 'expired' };
    const first = await call(access);
    if (first.kind !== 'unauthorized') return first;

    const refreshed = await auth.refreshAfter(access);
    if (refreshed === 'expired') return { kind: 'expired' };
    if (refreshed === 'offline') return { kind: 'network' };
    if (refreshed === 'error') return { kind: 'server_error', status: 0 };
    const renewed = await auth.getAccess();
    if (renewed === undefined) return { kind: 'expired' };
    const second = await call(renewed);
    if (second.kind === 'unauthorized') {
      await auth.expire();
      return { kind: 'expired' };
    }
    return second;
  }

  return {
    auth,
    sync(reason) {
      const manual = reason === 'manual';
      if (!running) return start(manual);
      followUpManual ||= manual;
      followUp ??= running.then(() => {
        const nextManual = followUpManual;
        followUp = null;
        followUpManual = false;
        return start(nextManual);
      });
      return followUp;
    },
    isSyncing: () => running !== null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function chunkSnapshot(chunk: readonly PushChange[], snapshot: PushSnapshot): PushSnapshot {
  const ids = new Set(chunk.map((change) => change.record.id));
  return new Map([...snapshot].filter(([id]) => ids.has(id)));
}

function failed(
  result: Exclude<ApiResult<unknown, SyncBadRequest>, { kind: 'ok' }> | Expired,
): Step {
  switch (result.kind) {
    case 'expired':
    case 'unauthorized':
      return { kind: 'failed', state: 'session_expired', errors: [] };
    case 'network':
      return { kind: 'failed', state: 'offline', errors: [] };
    case 'throttled':
    case 'server_error':
      return { kind: 'failed', state: 'error', errors: [] };
    case 'rejected': {
      const errors = rejectionErrors(result.body);
      const clockAhead = errors.some((error) => error.code === 'clock_ahead');
      return { kind: 'failed', state: clockAhead ? 'clock_ahead' : 'stopped', errors };
    }
  }
}

/** A 400: per-record errors, or DRF field errors for a malformed request. */
function rejectionErrors(body: SyncBadRequest): SyncError[] {
  if (isSyncRejected(body)) {
    return body.records.slice(0, MAX_ERRORS).map((record) => ({
      table: record.table,
      id: record.id,
      code: record.code,
      detail: typeof record.detail === 'string' ? record.detail : JSON.stringify(record.detail),
    }));
  }
  return [{ table: null, id: null, code: 'invalid', detail: JSON.stringify(body) }];
}

function isSyncRejected(body: SyncBadRequest): body is SyncRejected {
  return 'records' in body && Array.isArray(body.records);
}
