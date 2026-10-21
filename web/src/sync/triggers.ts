// When sync runs: on app open, when the app comes back to the foreground (an installed iOS PWA
// usually resumes instead of reloading, so "open" alone would rarely fire), on the `online`
// event, every 5 minutes while visible, and a few seconds after local edits. "Sincronizar" in
// the UI calls `sync('manual')` directly. None of it relies on background sync, which iOS
// doesn't have: a closed app syncs on its next open.

import type { ArcanaDB } from '../db';
import type { SyncEngine, SyncReason } from './engine';

export interface TriggerOptions {
  intervalMs?: number;
  /** Coming back to the foreground counts as an open at most this often. */
  visibleGapMs?: number;
  /** Quiet time after the last local edit before syncing it. */
  writeDebounceMs?: number;
  window?: Window;
  document?: Document;
  now?: () => number;
}

export const SYNC_INTERVAL_MS = 5 * 60_000;
export const VISIBLE_GAP_MS = 60_000;
export const WRITE_DEBOUNCE_MS = 3_000;

/** Starts the automatic triggers (and an immediate "open" run). Returns a stop function. */
export function startSyncTriggers(
  engine: SyncEngine,
  db: ArcanaDB,
  options: TriggerOptions = {},
): () => void {
  const {
    intervalMs = SYNC_INTERVAL_MS,
    visibleGapMs = VISIBLE_GAP_MS,
    writeDebounceMs = WRITE_DEBOUNCE_MS,
    window: win = window,
    document: doc = document,
    now = Date.now,
  } = options;

  const run = (reason: SyncReason) => {
    void engine.sync(reason);
  };

  let lastOpen = now();
  run('open');

  const onVisibility = () => {
    if (doc.visibilityState !== 'visible' || now() - lastOpen < visibleGapMs) return;
    lastOpen = now();
    run('visible');
  };
  const onOnline = () => {
    run('online');
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('online', onOnline);

  const interval = setInterval(() => {
    if (doc.visibilityState === 'visible') run('interval');
  }, intervalMs);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const stopWrites = db.onLocalWrite(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      run('local_write');
    }, writeDebounceMs);
  });

  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('online', onOnline);
    clearInterval(interval);
    clearTimeout(debounce);
    stopWrites();
  };
}
