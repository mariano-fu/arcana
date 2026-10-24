import { ArcanaDB } from '../db';
import { APP_BUILD, APP_BUILD_KEY, appBuild, clearStoppedOnNewBuild } from './appBuild';
import { INITIAL_STATUS, readStatus, writeStatus, type SyncState, type SyncStatus } from './status';

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

const stopped: SyncStatus = {
  state: 'stopped',
  last_success: '2026-10-20T15:00:00.000Z',
  clock_skew_ms: 120,
  errors: [{ table: 'client', id: null, code: 'invalid', detail: 'Campo inválido' }],
};

const storedBuild = async () => (await db.meta.get(APP_BUILD_KEY))?.value;

describe('clearStoppedOnNewBuild', () => {
  it('names the build by version, commit and build date', () => {
    expect(APP_BUILD).toBe(`${__APP_VERSION__}+${__APP_COMMIT__}@${__APP_BUILT_AT__}`);
  });

  it('tells apart two "dev" builds of the same version by their build date', async () => {
    const first = appBuild('0.1.0', 'dev', '2026-10-21T18:00:00.000Z');
    const second = appBuild('0.1.0', 'dev', '2026-10-22T09:30:00.000Z');
    expect(second).not.toBe(first);

    await clearStoppedOnNewBuild(db, first);
    await writeStatus(db, stopped);
    expect(await clearStoppedOnNewBuild(db, second)).toBe(true);
    expect((await readStatus(db)).state).toBe('idle');
  });

  it('clears a stopped status once on a new build, keeping the last success and skew', async () => {
    await db.meta.put({ key: APP_BUILD_KEY, value: '0.1.0+aaaaaaa' });
    await writeStatus(db, stopped);

    expect(await clearStoppedOnNewBuild(db, '0.1.0+bbbbbbb')).toBe(true);
    expect(await readStatus(db)).toEqual({ ...stopped, state: 'idle', errors: [] });
    expect(await storedBuild()).toBe('0.1.0+bbbbbbb');

    // Stopped again under the same build: it stays stopped.
    await writeStatus(db, stopped);
    expect(await clearStoppedOnNewBuild(db, '0.1.0+bbbbbbb')).toBe(false);
    expect(await readStatus(db)).toEqual(stopped);
  });

  it('counts a device with no stored build (before T4.7) as a new build', async () => {
    await writeStatus(db, stopped);

    expect(await clearStoppedOnNewBuild(db, '0.1.0+bbbbbbb')).toBe(true);
    expect((await readStatus(db)).state).toBe('idle');
    expect(await storedBuild()).toBe('0.1.0+bbbbbbb');
  });

  it.each<SyncState>(['clock_ahead', 'session_expired', 'error', 'offline', 'signed_out'])(
    'leaves %s alone, but records the build',
    async (state) => {
      const status = { ...stopped, state };
      await writeStatus(db, status);

      expect(await clearStoppedOnNewBuild(db, '0.1.0+bbbbbbb')).toBe(false);
      expect(await readStatus(db)).toEqual(status);
      expect(await storedBuild()).toBe('0.1.0+bbbbbbb');
    },
  );

  it('writes no status when sync never ran', async () => {
    expect(await clearStoppedOnNewBuild(db, '0.1.0+bbbbbbb')).toBe(false);
    expect(await readStatus(db)).toEqual(INITIAL_STATUS);
    expect(await db.meta.get('sync:status')).toBeUndefined();
  });
});
