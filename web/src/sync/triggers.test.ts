import { ArcanaDB } from '../db';
import type { SyncEngine, SyncReason } from './engine';
import { INITIAL_STATUS } from './status';
import { startSyncTriggers } from './triggers';

let db: ArcanaDB;
let reasons: SyncReason[];
let engine: SyncEngine;
let visibility: DocumentVisibilityState;
let stop: () => void;

beforeEach(() => {
  // Not setImmediate: fake-indexeddb schedules on it.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  reasons = [];
  engine = {
    auth: {
      getAccess: vi.fn(),
      login: vi.fn(),
      refreshAfter: vi.fn(),
      expire: vi.fn(),
    },
    sync: (reason) => {
      reasons.push(reason);
      return Promise.resolve(INITIAL_STATUS);
    },
    isSyncing: () => false,
    subscribe: () => () => {},
  };
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  stop = startSyncTriggers(engine, db, { now: () => Date.now() });
});

afterEach(async () => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('startSyncTriggers', () => {
  it('syncs on start', () => {
    expect(reasons).toEqual(['open']);
  });

  it('syncs on the online event', () => {
    window.dispatchEvent(new Event('online'));

    expect(reasons).toEqual(['open', 'online']);
  });

  it('counts coming back to the foreground as an open, at most once a minute', () => {
    setVisibility('hidden');
    setVisibility('visible');
    expect(reasons).toEqual(['open']);

    vi.advanceTimersByTime(61_000);
    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');

    expect(reasons).toEqual(['open', 'visible']);
  });

  it('syncs every 5 minutes, only while visible', () => {
    vi.advanceTimersByTime(5 * 60_000);
    expect(reasons).toEqual(['open', 'interval']);

    setVisibility('hidden');
    vi.advanceTimersByTime(10 * 60_000);
    expect(reasons).toEqual(['open', 'interval']);
  });

  it('syncs 3 s after the last of a burst of local edits', async () => {
    const pending = { id: 'c1', updated_at: '2026-10-20T12:00:00.000Z', pending: 1 as const };
    await db.meta.put({ key: 'not-an-edit', value: '' });
    for (let i = 0; i < 3; i++) {
      await db.table('client').put({ ...pending, deleted_at: null, server_version: null });
      vi.advanceTimersByTime(1000);
    }
    expect(reasons).toEqual(['open']);

    vi.advanceTimersByTime(3000);

    expect(reasons).toEqual(['open', 'local_write']);
  });

  it('stops every trigger', () => {
    stop();
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(10 * 60_000);

    expect(reasons).toEqual(['open']);
  });
});
