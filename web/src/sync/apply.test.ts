import { newClient, newPayment, newSession } from '../features/clients/test-utils';
import { ArcanaDB, createRepositories, type Client, type Repositories } from '../db';
import type { PulledChange, PushResult, SyncResponse } from './api';
import {
  applyResponse,
  countPending,
  NOTHING_PUSHED,
  readPending,
  restampClockAhead,
} from './apply';
import { CURSOR_KEY, EPOCH_KEY, readCursor } from './status';

let db: ArcanaDB;
let repos: Repositories;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  repos = createRepositories(db);
});

afterEach(async () => {
  await db.delete();
});

function response(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return {
    results: [],
    conflicts: [],
    changes: [],
    cursor: 10,
    server_time: new Date().toISOString(),
    epoch: 'epoch-1',
    ...overrides,
  };
}

const result = (id: string, status: PushResult['status']): PushResult => ({
  table: 'client',
  id,
  status,
});

function serverClient(client: Client, fields: Partial<Client> = {}): PulledChange {
  const { pending, ...record } = { ...client, ...fields };
  return { table: 'client', record: { ...record, server_version: fields.server_version ?? 9 } };
}

describe('applyResponse', () => {
  it.each(['applied', 'noop'] as const)(
    'clears pending on %s rows that are unchanged since the push',
    async (status) => {
      const client = await repos.client.create(newClient());
      const { snapshot } = await readPending(db);

      await applyResponse(db, response({ results: [result(client.id, status)] }), snapshot);

      expect(await db.client.get(client.id)).toEqual({ ...client, pending: 0 });
    },
  );

  it('keeps pending on an applied row edited while the request was in flight', async () => {
    const client = await repos.client.create(newClient());
    const { snapshot } = await readPending(db);
    const edited = await repos.client.update(client.id, { notes: 'Durante la sincronización' });

    await applyResponse(db, response({ results: [result(client.id, 'applied')] }), snapshot);

    const stored = await db.client.get(client.id);
    expect(stored?.pending).toBe(1);
    expect(stored?.updated_at).toBe(edited.updated_at);
  });

  it('overwrites a rejected push with the server row', async () => {
    const client = await repos.client.create(newClient({ name: 'Local' }));
    const { snapshot } = await readPending(db);
    const winner = serverClient(client, {
      name: 'Servidor',
      updated_at: '2030-01-01T00:00:00.000Z',
    });

    await applyResponse(
      db,
      response({ results: [result(client.id, 'rejected')], changes: [winner] }),
      snapshot,
    );

    const stored = await db.client.get(client.id);
    expect(stored?.name).toBe('Servidor');
    expect(stored?.pending).toBe(0);
    expect(stored?.server_version).toBe(9);
  });

  it('keeps a pending row edited after the push even if the server rejected the pushed version', async () => {
    const client = await repos.client.create(newClient({ name: 'Enviado' }));
    const { snapshot } = await readPending(db);
    await repos.client.update(client.id, { name: 'Editado después' });
    const incoming = serverClient(client, {
      name: 'Servidor',
      updated_at: '2030-01-01T00:00:00.000Z',
    });

    await applyResponse(
      db,
      response({ results: [result(client.id, 'rejected')], changes: [incoming] }),
      snapshot,
    );

    expect((await db.client.get(client.id))?.name).toBe('Editado después');
  });

  describe('a pulled row for a still-pending local record never overwrites it', () => {
    it('when the row is in the push but results say nothing about it', async () => {
      const client = await repos.client.create(newClient({ name: 'Local' }));
      const { snapshot } = await readPending(db);
      const incoming = serverClient(client, {
        name: 'Servidor',
        updated_at: '2030-01-01T00:00:00.000Z',
      });

      await applyResponse(db, response({ changes: [incoming] }), snapshot);

      expect(await db.client.get(client.id)).toEqual(client);
    });

    it('when the row is in the push with status applied', async () => {
      const client = await repos.client.create(newClient({ name: 'Local' }));
      const { snapshot } = await readPending(db);
      const incoming = serverClient(client, {
        name: 'Servidor',
        updated_at: '2030-01-01T00:00:00.000Z',
      });

      await applyResponse(
        db,
        response({ results: [result(client.id, 'applied')], changes: [incoming] }),
        snapshot,
      );

      expect(await db.client.get(client.id)).toEqual({ ...client, pending: 0 });
    });

    it('when the row is outside the push', async () => {
      const client = await repos.client.create(newClient({ name: 'Local' }));
      const incoming = serverClient(client, {
        name: 'Servidor',
        updated_at: '2030-01-01T00:00:00.000Z',
      });

      await applyResponse(
        db,
        response({ results: [result(client.id, 'rejected')], changes: [incoming] }),
        NOTHING_PUSHED,
      );

      expect(await db.client.get(client.id)).toEqual(client);
    });
  });

  it('ignores and logs a result for a row not in this push', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = await repos.client.create(newClient());

    await applyResponse(db, response({ results: [result(client.id, 'applied')] }), NOTHING_PUSHED);

    expect((await db.client.get(client.id))?.pending).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('stores new rows, updates synced ones, and stores tombstones, conflicts and horoscopes', async () => {
    const client = await repos.client.create(newClient());
    await db.client.put({ ...client, pending: 0, server_version: 3 });
    const fresh = { ...client, id: crypto.randomUUID(), name: 'Nueva' };
    const tombstone = serverClient(client, {
      updated_at: '2030-01-01T00:00:00.000Z',
      deleted_at: '2030-01-01T00:00:00.000Z',
      server_version: 11,
    });
    const conflict: PulledChange = {
      table: 'conflict',
      record: {
        id: crypto.randomUUID(),
        updated_at: '2030-01-01T00:00:00.000Z',
        deleted_at: null,
        server_version: 12,
        device_id: '00000000-0000-0000-0000-000000000000',
        table: 'client',
        record_id: client.id,
        field: 'notes',
        losing_value: 'Texto perdido',
        losing_device_id: 'other-device',
        created_at: '2030-01-01T00:00:00.000Z',
        resolved: false,
      },
    };
    const horoscope: PulledChange = {
      table: 'horoscope',
      record: {
        id: crypto.randomUUID(),
        updated_at: '2030-01-01T00:00:00.000Z',
        deleted_at: null,
        server_version: 13,
        device_id: '00000000-0000-0000-0000-000000000000',
        date: '2030-01-01',
        sign: 'aries',
        period: 'day',
        text_en: 'Text',
        text_es: 'Texto',
        source: 'manual',
        translator: 'none',
      },
    };

    await applyResponse(
      db,
      response({
        changes: [serverClient(fresh, { server_version: 10 }), tombstone, conflict, horoscope],
      }),
      NOTHING_PUSHED,
    );

    expect((await db.client.get(fresh.id))?.server_version).toBe(10);
    expect((await db.client.get(client.id))?.deleted_at).toBe('2030-01-01T00:00:00.000Z');
    expect(await db.conflict.get(conflict.record.id)).toMatchObject({
      pending: 0,
      resolved: false,
    });
    expect(await db.horoscope.get(horoscope.record.id)).toMatchObject({
      pending: 0,
      sign: 'aries',
    });
  });

  it('saves the cursor and epoch with the rows', async () => {
    await applyResponse(db, response({ cursor: 42, epoch: 'epoch-x' }), NOTHING_PUSHED);

    expect(await readCursor(db)).toBe(42);
    expect((await db.meta.get(EPOCH_KEY))?.value).toBe('epoch-x');
  });

  it('is all or nothing: a failure leaves the rows and the cursor as they were', async () => {
    const client = await repos.client.create(newClient());
    const { snapshot } = await readPending(db);
    await db.meta.put({ key: CURSOR_KEY, value: '5' });
    const incoming = serverClient({ ...client, id: crypto.randomUUID() });
    vi.spyOn(db.meta, 'bulkPut').mockRejectedValueOnce(new Error('closed mid-sync'));

    await expect(
      applyResponse(
        db,
        response({ results: [result(client.id, 'applied')], changes: [incoming] }),
        snapshot,
      ),
    ).rejects.toThrow('closed mid-sync');

    expect((await db.client.get(client.id))?.pending).toBe(1);
    expect(await db.client.count()).toBe(1);
    expect(await readCursor(db)).toBe(5);
  });
});

describe('readPending', () => {
  it('reads attached crystals after their session, and countPending counts them', async () => {
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    // Written before its session's payment, but still pushed after the session.
    await repos.session_crystal.create({ session_id: session.id, crystal_id: 'crystal-1' });
    await repos.payment.create(newPayment(session));

    const { changes } = await readPending(db);

    expect(changes.map((change) => change.table)).toEqual([
      'client',
      'session',
      'session_crystal',
      'payment',
    ]);
    expect(await countPending(db)).toBe(4);
  });
});

describe('restampClockAhead', () => {
  it('moves flagged pending rows back to now, leaving updated_at <= now', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const client = await createRepositories(db, () => future).client.create(newClient());
    const now = new Date().toISOString();

    await restampClockAhead(
      db,
      [{ table: 'client', id: client.id, code: 'clock_ahead', detail: '' }],
      now,
    );

    const stored = await db.client.get(client.id);
    expect(stored?.updated_at).toBe(now);
    expect(stored && stored.updated_at <= new Date().toISOString()).toBe(true);
    expect(stored?.pending).toBe(1);
  });

  it('ignores other errors and rows not ahead of now', async () => {
    const client = await repos.client.create(newClient());
    const future = await createRepositories(db, () => '2099-01-01T00:00:00.000Z').client.create(
      newClient(),
    );

    await restampClockAhead(
      db,
      [
        { table: 'client', id: client.id, code: 'clock_ahead', detail: '' },
        { table: 'horoscope', id: client.id, code: 'clock_ahead', detail: '' },
        { table: 'client', id: future.id, code: 'invalid', detail: '' },
      ],
      new Date(Date.parse(client.updated_at) + 60_000).toISOString(),
    );

    expect((await db.client.get(client.id))?.updated_at).toBe(client.updated_at);
    expect((await db.client.get(future.id))?.updated_at).toBe(future.updated_at);
  });
});
