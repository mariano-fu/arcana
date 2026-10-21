import { ArcanaDB, createRepositories, type Repositories } from '../../db';
import { createSyncEngine } from '../../sync/engine';
import { createLocalLocks } from '../../sync/locks';
import { FakeSyncServer } from '../../test/fakeSyncServer';
import { deleteClient } from '../clients/deletion';
import { newClient, newSession } from '../clients/test-utils';
import { ConflictNotWritableError, resolveConflict, restoreClient } from './actions';
import { conflictRow, SERVER_DEVICE } from './test-utils';

let db: ArcanaDB;
let repos: Repositories;
const T0 = '2026-10-20T12:00:00.000Z';

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  repos = createRepositories(db, () => T0);
});

afterEach(async () => {
  await db.delete();
});

async function clientWithConflict(notes = 'Actual') {
  const client = await repos.client.create(newClient({ notes }));
  await db.client.put({ ...client, pending: 0, server_version: 3 });
  const conflicts = [
    conflictRow('client', client.id, 'notes', { losing_value: 'Otra A' }),
    conflictRow('client', client.id, 'notes', { losing_value: 'Otra B' }),
  ];
  await db.conflict.bulkPut(conflicts);
  const target = {
    table: 'client' as const,
    recordId: client.id,
    field: 'notes',
    conflictIds: conflicts.map((conflict) => conflict.id),
  };
  return { client, conflicts, target };
}

async function expectResolved(ids: readonly string[]) {
  for (const id of ids) {
    const conflict = await db.conflict.get(id);
    expect(conflict).toMatchObject({ resolved: true, pending: 1 });
    expect(conflict?.deleted_at).not.toBeNull();
    expect(conflict?.deleted_at).toBe(conflict?.updated_at);
  }
}

describe('resolveConflict', () => {
  it('keep: resolves and tombstones every conflict of the field, record untouched', async () => {
    const { client, target } = await clientWithConflict();

    await resolveConflict(db, target, { kind: 'keep' }, () => T0);

    await expectResolved(target.conflictIds);
    expect(await db.client.get(client.id)).toEqual({ ...client, pending: 0, server_version: 3 });
  });

  it('write: puts the chosen or combined text into the field as a pending local edit', async () => {
    const { client, target } = await clientWithConflict();

    await resolveConflict(db, target, { kind: 'write', text: 'Actual\n\nOtra A' }, () => T0);

    const stored = await db.client.get(client.id);
    expect(stored).toMatchObject({ notes: 'Actual\n\nOtra A', pending: 1 });
    // The clock read the same millisecond: still later than the version it replaces.
    expect(stored?.updated_at).toBe('2026-10-20T12:00:00.001Z');
    await expectResolved(target.conflictIds);
  });

  it('discard: resolves a conflict whose row was deleted, writing nothing else', async () => {
    const { client, target } = await clientWithConflict();
    await repos.client.remove(client.id);
    const deleted = await db.client.get(client.id);

    await resolveConflict(db, target, { kind: 'discard' }, () => T0);

    await expectResolved(target.conflictIds);
    expect(await db.client.get(client.id)).toEqual(deleted);
  });

  it.each([
    ['a deleted row', 'notes', true],
    ['a field that is not free text', 'birth_date', false],
  ] as const)('refuses to write into %s, changing nothing', async (_case, field, remove) => {
    const { client, target } = await clientWithConflict();
    if (remove) await repos.client.remove(client.id);
    const before = await db.client.get(client.id);

    await expect(
      resolveConflict(db, { ...target, field }, { kind: 'write', text: 'x' }, () => T0),
    ).rejects.toThrow(ConflictNotWritableError);

    expect(await db.client.get(client.id)).toEqual(before);
    expect((await db.conflict.get(target.conflictIds[0] ?? ''))?.resolved).toBe(false);
  });

  it('is one transaction: a failure leaves the record and the conflicts as they were', async () => {
    const { client, target } = await clientWithConflict();
    vi.spyOn(db.conflict, 'put').mockRejectedValueOnce(new Error('closed mid-write'));

    await expect(
      resolveConflict(db, target, { kind: 'write', text: 'Nuevo' }, () => T0),
    ).rejects.toThrow('closed mid-write');

    expect((await db.client.get(client.id))?.notes).toBe('Actual');
    for (const id of target.conflictIds) {
      expect((await db.conflict.get(id))?.resolved).toBe(false);
    }
  });
});

describe('a device whose clock is behind the server', () => {
  it('still wins when it resolves a server-created conflict, through a real sync', async () => {
    // The server's clock is 10 minutes ahead of this device's.
    const server = new FakeSyncServer();
    const ahead = 10 * 60_000;
    server.now = () => Date.now() + ahead;
    const serverTime = new Date(server.now()).toISOString();
    const client = { ...newClient({ notes: 'Del servidor' }), id: crypto.randomUUID() };
    server.put('client', { ...client, updated_at: serverTime, deleted_at: null, device_id: 'b' });
    const conflict = conflictRow('client', client.id, 'notes', {
      losing_value: 'De este dispositivo',
      created_at: serverTime,
      updated_at: serverTime,
    });
    const { pending, server_version, ...record } = conflict;
    server.put('conflict', record);
    await db.auth.put({ key: 'tokens', ...server.issueTokens() });
    const engine = createSyncEngine({ db, api: server, locks: createLocalLocks() });
    await engine.sync('open');
    expect((await db.conflict.get(conflict.id))?.device_id).toBe(SERVER_DEVICE);

    await resolveConflict(
      db,
      { table: 'client', recordId: client.id, field: 'notes', conflictIds: [conflict.id] },
      { kind: 'write', text: 'Combinado' },
    );

    const resolved = await db.conflict.get(conflict.id);
    const edited = await db.client.get(client.id);
    expect(resolved && resolved.updated_at > serverTime).toBe(true);
    expect(edited && edited.updated_at > serverTime).toBe(true);

    server.requests = [];
    expect((await engine.sync('manual')).state).toBe('idle');

    const push = server.requests.find((request) => (request.changes ?? []).length > 0);
    expect(push?.changes?.map((change) => change.table).sort()).toEqual(['client', 'conflict']);
    expect(server.get('client', client.id)?.notes).toBe('Combinado');
    expect(server.get('conflict', conflict.id)).toMatchObject({ resolved: true });
    expect(server.get('conflict', conflict.id)?.deleted_at).not.toBeNull();
    expect((await db.conflict.get(conflict.id))?.pending).toBe(0);
    expect((await db.client.get(client.id))?.pending).toBe(0);
  });
});

describe('restoreClient', () => {
  it('brings the ficha back past its tombstone; its other deleted sessions stay deleted', async () => {
    const client = await repos.client.create(newClient());
    const kept = await repos.session.create(newSession(client.id));
    await deleteClient(db, client.id, () => T0);
    // The tombstone came from a device whose clock is ahead of this one.
    const tombstone = await db.client.get(client.id);
    if (!tombstone) throw new Error('client missing');
    await db.client.put({
      ...tombstone,
      updated_at: '2026-10-21T00:00:00.000Z',
      deleted_at: '2026-10-21T00:00:00.000Z',
      pending: 0,
    });

    await restoreClient(db, client.id, () => T0);

    const restored = await db.client.get(client.id);
    expect(restored).toMatchObject({ deleted_at: null, pending: 1 });
    expect(restored?.updated_at).toBe('2026-10-21T00:00:00.001Z');
    expect((await db.session.get(kept.id))?.deleted_at).not.toBeNull();
  });
});
