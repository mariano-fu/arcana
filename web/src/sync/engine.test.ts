import { newClient, newSession } from '../features/clients/test-utils';
import { loadSeed, seedId } from '../seed/loader';
import { FakeSyncServer } from '../test/fakeSyncServer';
import { ArcanaDB, createRepositories, getDeviceId, type Repositories } from '../db';
import { createAuth } from './auth';
import { createSyncEngine, type SyncEngine } from './engine';
import { createLocalLocks, type Locks } from './locks';
import { EPOCH_KEY, readCursor, readStatus, STATUS_KEY } from './status';

let db: ArcanaDB;
let server: FakeSyncServer;
let locks: Locks;
let engine: SyncEngine;
let repos: Repositories;

beforeEach(async () => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  server = new FakeSyncServer();
  locks = createLocalLocks();
  engine = createSyncEngine({ db, api: server, locks });
  repos = createRepositories(db);
  await signIn(db);
});

afterEach(async () => {
  await db.delete();
});

async function signIn(target: ArcanaDB) {
  await target.auth.put({ key: 'tokens', ...server.issueTokens() });
}

/** Every table but `auth`, and `meta` without the sync status: what auth failures must keep. */
async function localData(target: ArcanaDB) {
  const data: Record<string, unknown[]> = {};
  for (const table of target.tables) {
    if (table.name === 'auth' || table.name === 'meta') continue;
    data[table.name] = await table.toArray();
  }
  data.meta = (await target.meta.toArray()).filter((row) => row.key !== STATUS_KEY);
  return data;
}

/** A client row as another device would have pushed it. */
function remoteClient(id: string, updatedAt: string, name = 'Cliente remoto') {
  return {
    ...newClient({ name }),
    id,
    updated_at: updatedAt,
    deleted_at: null,
    device_id: 'other-device',
  };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('a sync run', () => {
  it('pushes pending rows, clears pending, pulls every page and saves the cursor', async () => {
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    server.pageSize = 2;
    for (let i = 0; i < 5; i++) server.put('client', remoteClient(crypto.randomUUID(), ago(10)));

    const status = await engine.sync('open');

    expect(status.state).toBe('idle');
    expect(status.last_success).not.toBeNull();
    expect(server.get('client', client.id)?.name).toBe('Cliente de prueba');
    expect(server.get('session', session.id)).toBeDefined();
    expect(await db.client.where('pending').equals(1).count()).toBe(0);
    expect(await db.session.where('pending').equals(1).count()).toBe(0);
    expect(await db.client.count()).toBe(6);
    expect(await readCursor(db)).toBe(server.version);
    expect((await db.meta.get(EPOCH_KEY))?.value).toBe(server.epoch);
    // Pulled rows are stored with their server_version and nothing to push.
    const pulled = await db.client.filter((row) => row.id !== client.id).toArray();
    expect(pulled.every((row) => row.pending === 0 && row.server_version !== null)).toBe(true);
  });

  it('sends the device id and the stored cursor', async () => {
    await engine.sync('open');
    server.put('client', remoteClient(crypto.randomUUID(), ago(1)));
    const cursor = await readCursor(db);

    await engine.sync('manual');

    const last = server.requests.at(-2);
    expect(last?.device_id).toBe(await getDeviceId(db));
    expect(last?.cursor).toBe(cursor);
  });

  it('splits pushes into chunks with parents before children', async () => {
    const client = await repos.client.create(newClient());
    await repos.session.create(newSession(client.id));
    await repos.session.create(newSession(client.id));
    const limited = createSyncEngine({
      db,
      api: server,
      locks,
      pushLimits: { maxRows: 2, maxBytes: 1_000_000 },
    });

    await limited.sync('open');

    const pushes = server.requests.filter((request) => (request.changes ?? []).length > 0);
    expect(pushes.map((request) => request.changes?.map((change) => change.table))).toEqual([
      ['client', 'session'],
      ['session'],
    ]);
    // Each chunk is sent with the cursor the previous response left.
    expect(pushes[1]?.cursor).toBe(2);
  });

  it('a pulled row still waiting in a later chunk stays pending and is pushed in that chunk', async () => {
    const first = await repos.client.create(newClient({ name: 'Primera' }));
    const waiting = await repos.client.create(newClient({ name: 'Su versión' }));
    // An older copy of `waiting` from another device: chunk 1's response pulls it.
    server.put('client', remoteClient(waiting.id, ago(60), 'Versión vieja del servidor'));
    const twoChunks = createSyncEngine({
      db,
      api: server,
      locks,
      pushLimits: { maxRows: 1, maxBytes: 1_000_000 },
    });
    const atChunk2: (typeof waiting | undefined)[] = [];
    const sync = server.sync.bind(server);
    vi.spyOn(server, 'sync').mockImplementation(async (access, body) => {
      if (body.changes?.some((change) => change.record.id === waiting.id)) {
        atChunk2.push(await db.client.get(waiting.id));
      }
      return sync(access, body);
    });

    expect((await twoChunks.sync('open')).state).toBe('idle');

    const pushes = server.requests.filter((request) => (request.changes ?? []).length > 0);
    expect(pushes.map((request) => request.changes?.map((change) => change.record.id))).toEqual([
      [first.id],
      [waiting.id],
    ]);
    // After chunk 1 it is untouched and pending; chunk 2 sends her version as it was.
    expect(atChunk2).toEqual([waiting]);
    expect(pushes[1]?.changes?.[0]?.record.updated_at).toBe(waiting.updated_at);
    // The server accepted her newer version, and the local row is its applied copy.
    expect(server.get('client', waiting.id)?.name).toBe('Su versión');
    expect(await db.client.get(waiting.id)).toEqual({ ...waiting, pending: 0 });
  });

  it('stops after maxPullPages pages, idle, and resumes from the cursor on the next run', async () => {
    server.pageSize = 1;
    for (let i = 0; i < 5; i++) server.put('client', remoteClient(crypto.randomUUID(), ago(10)));
    const capped = createSyncEngine({ db, api: server, locks, maxPullPages: 2 });

    expect((await capped.sync('open')).state).toBe('idle');
    expect(await readCursor(db)).toBe(2);

    await capped.sync('interval');
    expect(await readCursor(db)).toBe(4);
    await capped.sync('interval');
    expect(await readCursor(db)).toBe(5);
    expect(await db.client.count()).toBe(5);
  });

  it('records the clock skew from server_time', async () => {
    server.now = () => Date.now() + 5 * 60_000;

    const status = await engine.sync('open');

    expect(status.clock_skew_ms).toBeGreaterThan(5 * 60_000 - 1000);
    expect(status.clock_skew_ms).toBeLessThan(5 * 60_000 + 1000);
  });
});

describe('single flight', () => {
  it('queues exactly one follow-up run for calls made during a run', async () => {
    const release = server.hold();
    const first = engine.sync('open');
    const others = [engine.sync('interval'), engine.sync('online'), engine.sync('local_write')];
    expect(engine.isSyncing()).toBe(true);

    release();
    await Promise.all([first, ...others]);

    // Nothing to push: one pull request per run, two runs.
    expect(server.requests).toHaveLength(2);
    expect(engine.isSyncing()).toBe(false);
  });

  it('pushes edits made during a run in the follow-up run', async () => {
    const release = server.hold();
    const first = engine.sync('open');
    const client = await repos.client.create(newClient());
    const followUp = engine.sync('local_write');

    release();
    await Promise.all([first, followUp]);

    expect(server.get('client', client.id)).toBeDefined();
    expect((await db.client.get(client.id))?.pending).toBe(0);
  });

  it('never runs two engines (tabs) at once and refreshes once for both', async () => {
    const otherTab = new ArcanaDB(db.name);
    const otherEngine = createSyncEngine({ db: otherTab, api: server, locks });
    await repos.client.create(newClient());
    server.expireAccessTokens();

    const [a, b] = await Promise.all([engine.sync('open'), otherEngine.sync('open')]);

    expect(server.refreshCalls).toBe(1);
    expect(a.state).toBe('idle');
    expect(b.state).toBe('idle');
    otherTab.close();
  });
});

describe('auth', () => {
  it('refreshes after a 401 and retries the request once', async () => {
    server.expireAccessTokens();

    const status = await engine.sync('open');

    expect(status.state).toBe('idle');
    expect(server.refreshCalls).toBe(1);
    expect((await db.auth.get('tokens'))?.access).toBe('access-2');
  });

  it('serializes refreshes across tabs and adopts a token another tab rotated', async () => {
    const otherTab = new ArcanaDB(db.name);
    const authA = createAuth(db, server, locks);
    const authB = createAuth(otherTab, server, locks);
    const stale = await authA.getAccess();
    if (stale === undefined) throw new Error('signed in in beforeEach');
    server.expireAccessTokens();

    const outcomes = await Promise.all([authA.refreshAfter(stale), authB.refreshAfter(stale)]);

    expect(outcomes).toEqual(['refreshed', 'refreshed']);
    expect(server.refreshCalls).toBe(1);
    otherTab.close();
  });

  it('on a refused refresh: session_expired, tokens cleared, every other row kept', async () => {
    await loadSeed(db);
    const client = await repos.client.create(newClient());
    await engine.sync('open');
    await repos.client.update(client.id, { notes: 'Sin sincronizar' });
    const deviceId = await getDeviceId(db);
    const before = await localData(db);
    server.expireAccessTokens();
    const tokens = await db.auth.get('tokens');
    if (!tokens) throw new Error('signed in in beforeEach');
    await server.refresh(tokens.refresh); // Rotated elsewhere: the stored one is blacklisted.

    const status = await engine.sync('open');

    expect(status.state).toBe('session_expired');
    expect(await db.auth.count()).toBe(0);
    expect(await localData(db)).toEqual(before);
    expect(await getDeviceId(db)).toBe(deviceId);
    expect((await db.meta.get('device_id'))?.value).toBe(deviceId);
    expect((await db.client.get(client.id))?.pending).toBe(1);
  });

  it('a lost refresh response ends in session_expired on the next try, data kept', async () => {
    await repos.client.create(newClient());
    const before = await localData(db);
    server.expireAccessTokens();
    server.loseNextRefreshResponse = true;

    expect((await engine.sync('open')).state).toBe('offline');
    expect((await engine.sync('online')).state).toBe('session_expired');

    expect(server.refreshCalls).toBe(2);
    expect(await localData(db)).toEqual(before);
  });

  it('automatic runs skip while the session is expired; signing in again resumes', async () => {
    server.expireAccessTokens();
    await db.auth.update('tokens', { refresh: 'refresh-unknown' });
    expect((await engine.sync('open')).state).toBe('session_expired');
    const requests = server.requests.length;

    await engine.sync('interval');
    expect((await engine.sync('manual')).state).toBe('session_expired');
    expect(server.requests).toHaveLength(requests);

    expect(await engine.auth.login({ username: 'lectora', password: 'x' })).toBe('ok');
    expect((await readStatus(db)).state).toBe('idle');
    expect((await engine.sync('interval')).state).toBe('idle');
  });

  it('is signed_out without tokens and sends nothing', async () => {
    await db.auth.clear();

    expect((await engine.sync('open')).state).toBe('signed_out');
    expect(server.requests).toHaveLength(0);
  });
});

describe('a refused push (400)', () => {
  beforeEach(async () => {
    await repos.client.create(newClient());
    server.script.push({
      kind: 'rejected',
      body: {
        records: [
          { index: 0, table: 'client', id: 'x', code: 'invalid', detail: { name: ['Requerido.'] } },
        ],
      },
    });
  });

  it('stops with the details and keeps the pending rows', async () => {
    const status = await engine.sync('open');

    expect(status.state).toBe('stopped');
    expect(status.errors).toEqual([
      { table: 'client', id: 'x', code: 'invalid', detail: '{"name":["Requerido."]}' },
    ]);
    expect(await db.client.where('pending').equals(1).count()).toBe(1);
  });

  it('is not retried by automatic triggers; each manual run retries once', async () => {
    await engine.sync('open');
    for (const reason of ['interval', 'online', 'visible', 'local_write', 'open'] as const) {
      await engine.sync(reason);
    }
    expect(server.requests).toHaveLength(1);

    const status = await engine.sync('manual');

    expect(server.requests.length).toBeGreaterThan(1);
    expect(status.state).toBe('idle');
    expect(await db.client.where('pending').equals(1).count()).toBe(0);
  });

  it('stops on DRF field errors too', async () => {
    server.script = [{ kind: 'rejected', body: { changes: ['Too many.'] } }];

    const status = await engine.sync('open');

    expect(status.state).toBe('stopped');
    expect(status.errors[0]?.code).toBe('invalid');
  });
});

describe('clock_ahead', () => {
  it('asks to check the clock; a manual retry re-stamps only the flagged rows to now', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
    const aheadRepos = createRepositories(db, () => future);
    const ahead = await aheadRepos.client.create(newClient({ name: 'Adelantada' }));
    const fine = await repos.client.create(newClient());
    // Only `ahead` is far in the future; `fine` was stamped now.
    const status = await engine.sync('open');
    expect(status.state).toBe('clock_ahead');
    expect(status.errors.map((error) => error.id)).toEqual([ahead.id]);
    expect(await engine.sync('interval')).toEqual(status);

    // She fixes the clock and taps "Sincronizar".
    const tapped = await engine.sync('manual');

    expect(tapped.state).toBe('idle');
    const restamped = await db.client.get(ahead.id);
    expect(restamped && restamped.updated_at <= new Date().toISOString()).toBe(true);
    expect(restamped?.pending).toBe(0);
    expect((await db.client.get(fine.id))?.updated_at).toBe(fine.updated_at);
    expect(server.get('client', ahead.id)?.updated_at).toBe(restamped?.updated_at);
  });
});

describe('failures', () => {
  it.each([
    [{ kind: 'network' } as const, 'offline'],
    [{ kind: 'server_error', status: 502 } as const, 'error'],
    [{ kind: 'throttled' } as const, 'error'],
  ])('%o ends the run as %s without retrying', async (result, state) => {
    await repos.client.create(newClient());
    server.script.push(result);

    expect((await engine.sync('open')).state).toBe(state);
    expect(server.requests).toHaveLength(1);
    expect(await db.client.where('pending').equals(1).count()).toBe(1);

    // Not paused: the next trigger tries again.
    expect((await engine.sync('interval')).state).toBe('idle');
  });
});

describe('if the app closes mid-sync', () => {
  it('re-pushes rows the server applied before the response was lost; no duplicates', async () => {
    const client = await repos.client.create(newClient());
    server.script.push('lose_response');

    expect((await engine.sync('open')).state).toBe('offline');
    expect((await db.client.get(client.id))?.pending).toBe(1);
    const version = server.version;

    expect((await engine.sync('open')).state).toBe('idle');

    expect((await db.client.get(client.id))?.pending).toBe(0);
    expect(server.version).toBe(version); // The re-push was a no-op.
    expect(server.rows.size).toBe(1);
  });

  it('keeps the cursor of the last applied page', async () => {
    server.pageSize = 1;
    for (let i = 0; i < 3; i++) server.put('client', remoteClient(crypto.randomUUID(), ago(5)));
    const capped = createSyncEngine({ db, api: server, locks, maxPullPages: 1 });
    await capped.sync('open');
    server.script.push('lose_response');

    await capped.sync('open');

    expect(await readCursor(db)).toBe(1);
    await engine.sync('open');
    expect(await readCursor(db)).toBe(3);
    expect(await db.client.count()).toBe(3);
  });
});

describe('server epoch', () => {
  it('adopts the epoch on a new device; untouched seed rows never sync', async () => {
    await loadSeed(db);

    await engine.sync('open');

    expect((await db.meta.get(EPOCH_KEY))?.value).toBe(server.epoch);
    expect(server.requests.every((request) => (request.changes ?? []).length === 0)).toBe(true);
  });

  it('first sync of pre-sync data uploads every user row, pending or not, and pulls nothing over it', async () => {
    // Written by pre-T3.6 code: no epoch, no cursor, some rows with pending = 0.
    await loadSeed(db);
    const old = '2026-09-01T10:00:00.000Z';
    const client = await createRepositories(db, () => old).client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    const deleted = await repos.client.create(newClient({ name: 'Eliminada' }));
    await repos.client.remove(deleted.id);
    await db.client.bulkPut(
      (await db.client.toArray()).map((row) => ({ ...row, pending: 0 as const })),
    );
    await db.session.put({ ...session, pending: 0 });
    const crystalId = seedId('crystal', 'amethyst');
    await repos.crystal.update(crystalId, { hidden: true }); // An edited seed row, pending = 1.
    // Edited seed rows whose pending flag says 0: still hers, so they must upload.
    const editedId = seedId('crystal', 'rose-quartz');
    const hiddenId = seedId('crystal', 'clear-quartz');
    const edited = await db.crystal.get(editedId);
    const hidden = await db.crystal.get(hiddenId);
    if (!edited || !hidden) throw new Error('seed crystals missing');
    await db.crystal.bulkPut([
      { ...edited, description: 'Su propia descripción', user_modified: true, pending: 0 },
      { ...hidden, hidden: true, pending: 0 },
    ]);
    const untouchedId = seedId('crystal', 'citrine');
    const before = new Map(
      [...(await db.client.toArray()), ...(await db.session.toArray())].map((row) => [row.id, row]),
    );
    // The server holds an older copy of her client, from another device.
    server.put('client', { ...remoteClient(client.id, '2026-08-01T00:00:00.000Z', 'Vieja') });

    expect((await engine.sync('open')).state).toBe('idle');

    for (const [id, row] of before) {
      const local = (await db.client.get(id)) ?? (await db.session.get(id));
      expect(local).toEqual({ ...row, pending: 0 });
      const table = 'client_id' in row ? 'session' : 'client';
      expect(server.get(table, id)?.updated_at).toBe(row.updated_at);
    }
    expect(server.get('client', client.id)?.name).toBe('Cliente de prueba');
    expect(server.get('client', deleted.id)?.deleted_at).not.toBeNull();
    expect(server.get('crystal', crystalId)?.hidden).toBe(true);
    expect(server.get('crystal', editedId)?.description).toBe('Su propia descripción');
    expect(server.get('crystal', hiddenId)?.hidden).toBe(true);
    expect(server.get('crystal', untouchedId)).toBeUndefined();
    expect((await db.crystal.get(editedId))?.pending).toBe(0);
    const tables = new Set([...server.rows.values()].map((row) => row.table));
    expect(tables.has('spread_template')).toBe(false);
    expect(tables.has('intention_tag')).toBe(false);

    // Only the first sync: later runs push only real edits.
    const pushed = server.requests.flatMap((request) => request.changes ?? []).length;
    await engine.sync('manual');
    expect(server.requests.flatMap((request) => request.changes ?? [])).toHaveLength(pushed);
  });

  it('on an epoch change: cursor to 0, every row re-pushed with its updated_at, nothing lost', async () => {
    await loadSeed(db);
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    await repos.session.remove(session.id);
    const crystalId = seedId('crystal', 'amethyst');
    await repos.crystal.update(crystalId, { hidden: true });
    server.put('client', remoteClient(crypto.randomUUID(), ago(30), 'De otro dispositivo'));
    await engine.sync('open');
    const before = new Map(
      [...(await db.client.toArray()), ...(await db.session.toArray())].map((row) => [
        row.id,
        row.updated_at,
      ]),
    );
    expect(before.size).toBe(3);

    server.resetDatabase();
    server.put('horoscope', { id: crypto.randomUUID(), updated_at: ago(1), date: '2026-10-20' });
    const status = await engine.sync('open');

    expect(status.state).toBe('idle');
    expect((await db.meta.get(EPOCH_KEY))?.value).toBe(server.epoch);
    expect(await readCursor(db)).toBe(server.version);
    for (const [id, updatedAt] of before) {
      const local = (await db.client.get(id)) ?? (await db.session.get(id));
      expect(local?.updated_at).toBe(updatedAt);
      expect(local?.pending).toBe(0);
      expect(server.get(local && 'client_id' in local ? 'session' : 'client', id)?.updated_at).toBe(
        updatedAt,
      );
    }
    // The tombstone is re-pushed as a tombstone.
    expect(server.get('session', session.id)?.deleted_at).not.toBeNull();
    // Her edited seed crystal is re-pushed; untouched seed rows (never on the server) are not.
    expect(server.get('crystal', crystalId)?.hidden).toBe(true);
    const pushedTables = new Set([...server.rows.values()].map((row) => row.table));
    expect(pushedTables.has('spread_template')).toBe(false);
    expect(pushedTables.has('intention_tag')).toBe(false);
    expect(await db.horoscope.count()).toBe(1);
  });

  it('in one sync(): discards the mismatched page, resets the cursor to 0, re-pushes everything, then pulls', async () => {
    const client = await repos.client.create(newClient());
    await engine.sync('open');
    expect((await db.client.get(client.id))?.pending).toBe(0);
    server.resetDatabase();
    const remote = remoteClient(crypto.randomUUID(), ago(1));
    server.put('client', remote);
    // The first response of the run comes from the new database, with a page relative to the
    // old cursor: it must not be applied.
    const bogus = remoteClient(crypto.randomUUID(), ago(1), 'No debe guardarse');
    server.script.push({
      kind: 'ok',
      body: {
        applied: [],
        conflicts: [],
        changes: [{ table: 'client', record: { ...bogus, server_version: 99 } }],
        cursor: 99,
        server_time: new Date().toISOString(),
        epoch: server.epoch,
      },
    });
    const sent = server.requests.length;

    const status = await engine.sync('open');

    expect(status.state).toBe('idle');
    const run = server.requests.slice(sent);
    // 1: the mismatched exchange (old cursor). 2: re-push from cursor 0. Then pulls.
    expect(run[0]?.cursor).toBeGreaterThan(0);
    expect(run[1]?.cursor).toBe(0);
    expect(run[1]?.changes?.map((change) => change.record.id)).toEqual([client.id]);
    expect(run.slice(2).every((request) => (request.changes ?? []).length === 0)).toBe(true);
    expect(run.length).toBeGreaterThanOrEqual(3);
    expect(await db.client.get(bogus.id)).toBeUndefined();
    expect(await db.client.get(remote.id)).toBeDefined();
    expect(server.get('client', client.id)?.updated_at).toBe(client.updated_at);
    expect(await readCursor(db)).toBe(server.version);
    expect((await db.meta.get(EPOCH_KEY))?.value).toBe(server.epoch);
  });
});

describe('unexpected errors', () => {
  it('end the run as error without rejecting, and the next run works', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.meta, 'bulkPut').mockRejectedValueOnce(new Error('quota'));

    expect((await engine.sync('open')).state).toBe('error');
    expect(error).toHaveBeenCalled();
    expect((await engine.sync('interval')).state).toBe('idle');
  });
});
