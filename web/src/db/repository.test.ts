import { ArcanaDB, createRepositories, getDeviceId, RowNotFoundError, type Repositories } from '.';
import type { Client, NewRow } from '.';

const newClient = (overrides: Partial<NewRow<Client>> = {}): NewRow<Client> => ({
  name: 'Cliente de prueba',
  instagram: null,
  whatsapp: null,
  email: null,
  birth_date: null,
  birth_time: null,
  birth_place_label: null,
  birth_lat: null,
  birth_lng: null,
  birth_tz: null,
  notes: '',
  tags: [],
  archived: false,
  created_at: '2026-10-01T12:00:00.000Z',
  ...overrides,
});

/** A clock that advances one second per call, so every write gets a distinct timestamp. */
function fakeClock(start = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(start);
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

let db: ArcanaDB;
let repos: Repositories;
let deviceId: string;

beforeEach(async () => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  repos = createRepositories(db, fakeClock());
  deviceId = await getDeviceId(db);
});

afterEach(async () => {
  await db.delete();
});

describe('create', () => {
  it('stamps id, updated_at, device_id and pending, and leaves server fields empty', async () => {
    const client = await repos.client.create(newClient());

    expect(client.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(client.updated_at).toBe('2026-01-01T00:00:00.000Z');
    expect(client.device_id).toBe(deviceId);
    expect(client.pending).toBe(1);
    expect(client.deleted_at).toBeNull();
    expect(client.server_version).toBeNull();
    expect(await repos.client.get(client.id)).toEqual(client);
  });

  it('ignores system fields smuggled in by the caller', async () => {
    const smuggled = { ...newClient(), id: 'x', pending: 0, server_version: 99, device_id: 'y' };

    const client = await repos.client.create(smuggled);

    expect(client.id).not.toBe('x');
    expect(client.pending).toBe(1);
    expect(client.server_version).toBeNull();
    expect(client.device_id).toBe(deviceId);
  });
});

describe('update', () => {
  it('merges the patch and re-stamps updated_at, device_id and pending', async () => {
    const client = await repos.client.create(newClient());
    // Simulate a completed sync.
    await db.client.update(client.id, { pending: 0, server_version: 7, device_id: 'other-device' });

    const updated = await repos.client.update(client.id, { notes: 'Nueva nota' });

    expect(updated.notes).toBe('Nueva nota');
    expect(updated.name).toBe(client.name);
    expect(updated.updated_at > client.updated_at).toBe(true);
    expect(updated.pending).toBe(1);
    expect(updated.device_id).toBe(deviceId);
    expect(updated.server_version).toBe(7);
    expect(await repos.client.get(client.id)).toEqual(updated);
  });

  it('cannot change system fields through the patch', async () => {
    const client = await repos.client.create(newClient());
    const patch = {
      notes: 'x',
      id: 'x',
      deleted_at: '2026-02-01T00:00:00.000Z',
      server_version: 5,
    };

    const updated = await repos.client.update(client.id, patch);

    expect(updated.id).toBe(client.id);
    expect(updated.deleted_at).toBeNull();
    expect(updated.server_version).toBeNull();
  });

  it('rejects missing and deleted rows', async () => {
    await expect(repos.client.update('missing', { notes: 'x' })).rejects.toBeInstanceOf(
      RowNotFoundError,
    );

    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);
    await expect(repos.client.update(client.id, { notes: 'x' })).rejects.toBeInstanceOf(
      RowNotFoundError,
    );
  });
});

describe('remove', () => {
  it('writes a pending tombstone instead of deleting the row', async () => {
    const client = await repos.client.create(newClient());
    await db.client.update(client.id, { pending: 0 });

    await repos.client.remove(client.id);

    const tombstone = await db.client.get(client.id);
    expect(tombstone?.deleted_at).toBe(tombstone?.updated_at);
    expect(tombstone?.updated_at).not.toBe(client.updated_at);
    expect(tombstone?.pending).toBe(1);
    expect(tombstone?.device_id).toBe(deviceId);
  });

  it('rejects missing and already-deleted rows', async () => {
    await expect(repos.client.remove('missing')).rejects.toBeInstanceOf(RowNotFoundError);

    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);
    await expect(repos.client.remove(client.id)).rejects.toBeInstanceOf(RowNotFoundError);
  });
});

describe('reads', () => {
  it('hide tombstones unless includeDeleted is set', async () => {
    const kept = await repos.client.create(newClient({ name: 'A' }));
    const gone = await repos.client.create(newClient({ name: 'B' }));
    await repos.client.remove(gone.id);

    expect(await repos.client.get(gone.id)).toBeUndefined();
    expect((await repos.client.get(gone.id, { includeDeleted: true }))?.id).toBe(gone.id);
    expect((await repos.client.list()).map((c) => c.id)).toEqual([kept.id]);
    expect(await repos.client.list({ includeDeleted: true })).toHaveLength(2);
  });

  it('list returns rows in creation order (UUIDv7 primary key)', async () => {
    const created = [];
    for (const name of ['A', 'B', 'C'])
      created.push(await repos.client.create(newClient({ name })));

    expect((await repos.client.list()).map((c) => c.id)).toEqual(created.map((c) => c.id));
  });

  it('listPending returns unsynced rows, including tombstones', async () => {
    const synced = await repos.client.create(newClient({ name: 'Synced' }));
    await db.client.update(synced.id, { pending: 0 });
    const fresh = await repos.client.create(newClient({ name: 'Fresh' }));
    const deleted = await repos.client.create(newClient({ name: 'Deleted' }));
    await repos.client.remove(deleted.id);

    const pendingIds = (await repos.client.listPending()).map((c) => c.id).sort();

    expect(pendingIds).toEqual([fresh.id, deleted.id].sort());
  });
});

describe('horoscope', () => {
  it('is read-only on the client', () => {
    expect(Object.keys(repos.horoscope).sort()).toEqual(['get', 'list']);
  });
});

describe('every writable table', () => {
  it('gets a repository that stamps writes', async () => {
    const session = await repos.session.create({
      client_id: 'c1',
      started_at: '2026-01-01T10:00:00.000Z',
      type: 'in_person',
      price_minor: 1500000,
      currency: 'CRC',
      notes: '',
      follow_up_note: '',
      follow_up_date: null,
    });
    const payment = await repos.payment.create({
      session_id: session.id,
      client_id: 'c1',
      amount_minor: 1500000,
      currency: 'CRC',
      method: 'sinpe',
      paid_at: '2026-01-01',
      reference: null,
      note: '',
    });

    expect(await repos.session.listPending()).toEqual([session]);
    expect(await repos.payment.listPending()).toEqual([payment]);
    expect(await db.payment.where('session_id').equals(session.id).toArray()).toEqual([payment]);
  });
});

describe('restore', () => {
  it('undoes a soft delete with a new stamp, pending again', async () => {
    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);

    const restored = await repos.client.restore(client.id);

    expect(restored.deleted_at).toBeNull();
    expect(restored.pending).toBe(1);
    expect(restored.updated_at > client.updated_at).toBe(true);
    expect(await repos.client.get(client.id)).toEqual(restored);
  });

  it('leaves a live row as it is', async () => {
    const client = await repos.client.create(newClient());

    expect(await repos.client.restore(client.id)).toEqual(client);
  });

  it('throws for a row that does not exist', async () => {
    await expect(repos.client.restore('missing')).rejects.toThrow(RowNotFoundError);
  });
});
