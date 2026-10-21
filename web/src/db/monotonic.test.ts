import { newClient, newSession } from '../features/clients/test-utils';
import { deleteClient } from '../features/clients/deletion';
import { deleteSession } from '../features/sessions/actions';
import { loadSeed, seedId } from '../seed/loader';
import { ArcanaDB, createRepositories, getDeviceId, nextUpdatedAt, writeVerbatim } from '.';
import type { Client } from '.';

const T0 = '2026-10-20T12:00:00.000Z';
const fixedClock = (iso: string) => () => iso;

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('nextUpdatedAt', () => {
  it('is the given time when it is later than the stored one', () => {
    expect(nextUpdatedAt('2026-10-20T12:00:01.000Z', T0)).toBe('2026-10-20T12:00:01.000Z');
  });

  it('is the stored time + 1 ms when the clock reads the same or an earlier time', () => {
    expect(nextUpdatedAt(T0, T0)).toBe('2026-10-20T12:00:00.001Z');
    expect(nextUpdatedAt('2026-10-19T00:00:00.000Z', T0)).toBe('2026-10-20T12:00:00.001Z');
  });

  it('is the given time for a new row', () => {
    expect(nextUpdatedAt(T0, undefined)).toBe(T0);
  });
});

describe('monotonic updated_at middleware', () => {
  it('bumps repository updates and removes made at the same millisecond', async () => {
    const repos = createRepositories(db, fixedClock(T0));
    const client = await repos.client.create(newClient());
    expect(client.updated_at).toBe(T0);

    const updated = await repos.client.update(client.id, { name: 'Otro nombre' });
    expect(updated.updated_at).toBe('2026-10-20T12:00:00.001Z');
    expect((await db.client.get(client.id))?.updated_at).toBe('2026-10-20T12:00:00.001Z');

    await repos.client.remove(client.id);
    const tombstone = await db.client.get(client.id);
    expect(tombstone?.updated_at).toBe('2026-10-20T12:00:00.002Z');
    expect(tombstone?.deleted_at).toBe(tombstone?.updated_at);
  });

  it('beats a stored version from a clock ahead of this device', async () => {
    // A row pulled from the server, stamped by a device (or server) whose clock is ahead.
    const repos = createRepositories(db, fixedClock(T0));
    const client = await repos.client.create(newClient());
    const ahead = '2026-10-20T12:05:00.000Z';
    await db.client.put({ ...client, updated_at: ahead, pending: 0, server_version: 7 });

    const edited = await repos.client.update(client.id, { notes: 'Nota' });

    expect(edited.updated_at).toBe('2026-10-20T12:05:00.001Z');
  });

  it('bumps every row of a bulkPut tombstone cascade', async () => {
    const repos = createRepositories(db, fixedClock(T0));
    const client = await repos.client.create(newClient());
    const sessions = [
      await repos.session.create(newSession(client.id)),
      await repos.session.create(newSession(client.id)),
    ];

    await deleteClient(db, client.id, fixedClock(T0));

    for (const session of sessions) {
      const stored = await db.session.get(session.id);
      expect(stored?.updated_at).toBe('2026-10-20T12:00:00.001Z');
      expect(stored?.deleted_at).toBe(stored?.updated_at);
    }
    expect((await db.client.get(client.id))?.updated_at).toBe('2026-10-20T12:00:00.001Z');
  });

  it('bumps the session tombstone written by deleteSession', async () => {
    const repos = createRepositories(db, fixedClock(T0));
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));

    await deleteSession(db, session.id, fixedClock(T0));

    expect((await db.session.get(session.id))?.updated_at).toBe('2026-10-20T12:00:00.001Z');
  });

  it('bumps writes made through Table.update()', async () => {
    const client = await createRepositories(db, fixedClock(T0)).client.create(newClient());

    await db.client.update(client.id, { name: 'Otro nombre', updated_at: T0, pending: 1 });

    expect(await db.client.get(client.id)).toMatchObject({
      name: 'Otro nombre',
      updated_at: '2026-10-20T12:00:00.001Z',
    });
  });

  it('bumps writes made through Collection.modify(), with an object or a function', async () => {
    const repos = createRepositories(db, fixedClock(T0));
    const a = await repos.client.create(newClient({ name: 'A' }));
    const b = await repos.client.create(newClient({ name: 'B' }));

    // A real change: modify() with an object skips rows it wouldn't change.
    await db.client
      .where('id')
      .anyOf([a.id, b.id])
      .modify({ archived: true, updated_at: T0, pending: 1 });
    expect((await db.client.get(a.id))?.updated_at).toBe('2026-10-20T12:00:00.001Z');
    expect((await db.client.get(b.id))?.updated_at).toBe('2026-10-20T12:00:00.001Z');

    // A plain key range: Dexie also sends `criteria` and `changeSpec` with the values.
    await db.client.where('id').equals(b.id).modify({ name: 'B2', updated_at: T0, pending: 1 });
    expect((await db.client.get(b.id))?.updated_at).toBe('2026-10-20T12:00:00.002Z');

    await db.client
      .where('id')
      .equals(a.id)
      .modify((row) => {
        row.notes = 'Nota';
        row.updated_at = T0;
        row.deleted_at = T0;
        row.pending = 1;
      });
    expect(await db.client.get(a.id)).toMatchObject({
      notes: 'Nota',
      updated_at: '2026-10-20T12:00:00.002Z',
      deleted_at: '2026-10-20T12:00:00.002Z',
    });
  });

  it('stores pending = 0 writes as given (seed rows, pulled rows)', async () => {
    await loadSeed(db, undefined, fixedClock(T0));
    const id = seedId('crystal', 'amethyst');
    const seeded = await db.crystal.get(id);
    expect(seeded?.updated_at).toBe(T0);

    if (!seeded) throw new Error('amethyst seed row missing');
    await db.crystal.put({ ...seeded, updated_at: '2026-01-01T00:00:00.000Z', pending: 0 });

    expect((await db.crystal.get(id))?.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves writes inside writeVerbatim exactly as given', async () => {
    const repos = createRepositories(db, fixedClock(T0));
    const client = await repos.client.create(newClient());
    const earlier = '2026-10-20T11:00:00.000Z';

    await writeVerbatim(db, [db.client], async () => {
      await db.client.put({ ...client, updated_at: earlier, pending: 1 });
    });

    expect((await db.client.get(client.id))?.updated_at).toBe(earlier);
    // Only that transaction: the next ordinary write is bumped again.
    await db.client.put({ ...client, updated_at: earlier, pending: 1 });
    expect((await db.client.get(client.id))?.updated_at).toBe('2026-10-20T11:00:00.001Z');
  });

  it('notifies local-write listeners for pending writes only', async () => {
    const listener = vi.fn();
    const unsubscribe = db.onLocalWrite(listener);
    const repos = createRepositories(db, fixedClock(T0));

    const client = await repos.client.create(newClient());
    expect(listener).toHaveBeenCalledTimes(1);

    const synced: Client = { ...client, pending: 0, server_version: 1 };
    await db.client.put(synced);
    await writeVerbatim(db, [db.client], async () => {
      await db.client.put({ ...synced, pending: 1 });
    });
    await db.meta.put({ key: 'x', value: 'y' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await repos.client.update(client.id, { name: 'Otro' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await getDeviceId(db)).toBe(client.device_id);
  });
});
