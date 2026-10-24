import { newClient } from '../clients/test-utils';
import { ArcanaDB, createRepositories, getDeviceId, newId, type Repositories } from '../../db';
import { bundledSeed, loadSeed, seedId } from '../../seed/loader';
import { applyResponse, readPending } from '../../sync/apply';
import { createSyncEngine } from '../../sync/engine';
import { createLocalLocks } from '../../sync/locks';
import { CURSOR_KEY, EPOCH_KEY, readStatus } from '../../sync/status';
import { FakeSyncServer } from '../../test/fakeSyncServer';
import type { Backup } from './format';
import {
  applyImport,
  conflictId,
  futureRows,
  MAX_BACKUP_BYTES,
  previewImport,
  readBackupFile,
  type ImportCounts,
} from './import';
import {
  at,
  backupWith,
  clientRow,
  exportOf,
  OTHER_DEVICE,
  rowsIn,
  sessionRow,
  stored,
} from './test-utils';

let db: ArcanaDB;
let repos: Repositories;

beforeEach(async () => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  repos = createRepositories(db);
  // As in the app, where loading the seed at startup creates it before any import.
  await getDeviceId(db);
});

afterEach(async () => {
  // The export self-check passes on every database these tests leave behind.
  await exportOf(db);
  await db.delete();
});

const counts = (fields: Partial<ImportCounts>): ImportCounts => ({
  added: 0,
  updated: 0,
  deleted: 0,
  kept: 0,
  unchanged: 0,
  ...fields,
});

async function importOk(backup: Backup): Promise<ImportCounts> {
  const result = await applyImport(db, backup);
  if (!result.ok) throw new Error(`import failed: ${result.problem.kind}`);
  return result.counts;
}

/** Every table, `pending` included, for before/after comparisons. */
async function everything(target: ArcanaDB) {
  const data: Record<string, unknown[]> = {};
  for (const table of target.tables) data[table.name] = await table.toArray();
  return data;
}

describe('into an empty device', () => {
  it('stores every row as in the file, pending, with ids and times unchanged', async () => {
    const client = clientRow(at(1));
    const session = sessionRow(client.id, at(2));
    const gone = clientRow(at(3), { deleted_at: at(3) });

    const result = await importOk(backupWith({ client: [client, gone], session: [session] }));

    expect(result).toEqual(counts({ added: 2, unchanged: 1 }));
    expect(await db.client.get(client.id)).toEqual(stored(client, 1));
    expect(await db.client.get(gone.id)).toEqual(stored(gone, 1));
    expect(await db.session.get(session.id)).toEqual(stored(session, 1));
  });

  it('keeps the server_version from the file for rows this device lacks', async () => {
    const client = clientRow(at(1), { server_version: 40 });
    await importOk(backupWith({ client: [client] }));
    expect((await db.client.get(client.id))?.server_version).toBe(40);
  });

  it('never touches the cursor, the epoch, the device id or the login', async () => {
    const deviceId = await getDeviceId(db);
    await db.meta.bulkPut([
      { key: CURSOR_KEY, value: '17' },
      { key: EPOCH_KEY, value: 'epoch-1' },
    ]);
    await db.auth.put({ key: 'tokens', access: 'a', refresh: 'r' });
    const meta = await db.meta.toArray();

    await importOk(backupWith({ client: [clientRow(at(1))] }));

    expect(await db.meta.toArray()).toEqual(meta);
    expect(await getDeviceId(db)).toBe(deviceId);
    expect(await db.auth.toArray()).toEqual([{ key: 'tokens', access: 'a', refresh: 'r' }]);
  });
});

describe('merging into a device with data', () => {
  it('never duplicates a row, and a second import of the same file writes nothing', async () => {
    const { pending, ...mine } = await repos.client.create(newClient({ name: 'Cliente local' }));
    const backup = backupWith({ client: [mine, clientRow(at(1))] });

    expect(await importOk(backup)).toEqual(counts({ added: 1, unchanged: 1 }));
    await db.client.toCollection().modify({ pending: 0 });
    const before = await everything(db);

    expect(await importOk(backup)).toEqual(counts({ unchanged: 2 }));
    expect(await everything(db)).toEqual(before);
    expect(await db.client.count()).toBe(2);
  });

  it('a newer row overwrites, keeps this device’s server_version and is pending', async () => {
    const local = { ...clientRow(at(1), { name: 'Antes' }), server_version: 7 };
    await db.client.put(stored(local, 0));
    const newer = { ...local, name: 'Después', updated_at: at(2), server_version: 99 };

    expect(await importOk(backupWith({ client: [newer] }))).toEqual(counts({ updated: 1 }));
    expect(await db.client.get(local.id)).toEqual({ ...newer, server_version: 7, pending: 1 });
  });

  it('an older row loses: the local row stays exactly as it was', async () => {
    const local = stored(clientRow(at(5), { name: 'Más reciente' }), 1);
    await db.client.put(local);
    const older = { ...local, name: 'Viejo', updated_at: at(4) };

    expect(await importOk(backupWith({ client: [older] }))).toEqual(counts({ kept: 1 }));
    expect(await db.client.get(local.id)).toEqual(local);
  });

  it('on equal updated_at with different content, the local row wins', async () => {
    const local = stored(clientRow(at(5), { notes: 'Local' }), 0);
    await db.client.put(local);
    const tie = { ...local, notes: 'Del respaldo', device_id: newId() };

    expect(await importOk(backupWith({ client: [tie] }))).toEqual(counts({ kept: 1 }));
    expect(await db.client.get(local.id)).toEqual(local);
  });

  it('on equal updated_at and content, nothing is written whatever the device or version', async () => {
    const local = stored({ ...clientRow(at(5)), server_version: 3 }, 0);
    await db.client.put(local);
    const same = { ...local, device_id: newId(), server_version: 8 };

    expect(await importOk(backupWith({ client: [same] }))).toEqual(counts({ unchanged: 1 }));
    expect(await db.client.get(local.id)).toEqual(local);
  });

  it('compares content regardless of key order', async () => {
    const { pending, ...row } = stored(clientRow(at(5)), 0);
    await db.client.put({ pending, ...row });
    const reordered = Object.fromEntries(Object.entries(row).reverse()) as typeof row;
    expect(await importOk(backupWith({ client: [reordered] }))).toEqual(counts({ unchanged: 1 }));
  });

  it('keeps pending local text it overwrites as one conflict, also on a re-import', async () => {
    // The scheme matches the server's: Python's uuid5 under CONFLICT_ID_NAMESPACE.
    expect(
      conflictId(
        'client',
        '0190f3a0-0000-7000-8000-000000000001',
        'notes',
        '2026-10-01T12:00:00.000Z',
        '0190f3a0-0000-7000-8000-0000000000aa',
      ),
    ).toBe('445fb365-4e60-5376-96ac-91c963431607');

    const localDevice = await getDeviceId(db);
    const local = clientRow(at(1), { notes: 'texto local', device_id: localDevice });
    await db.client.put(stored(local, 1));
    const backup = backupWith({
      client: [
        { ...local, notes: 'texto del archivo', updated_at: at(2), device_id: OTHER_DEVICE },
      ],
    });

    expect(await importOk(backup)).toEqual(counts({ updated: 1 }));
    expect((await db.client.get(local.id))?.notes).toBe('texto del archivo');
    const expected = {
      id: conflictId('client', local.id, 'notes', local.updated_at, localDevice),
      table: 'client',
      record_id: local.id,
      field: 'notes',
      losing_value: 'texto local',
      losing_device_id: localDevice,
      resolved: false,
      pending: 1,
    };
    expect(await db.conflict.toArray()).toEqual([expect.objectContaining(expected)]);

    await importOk(backup);
    expect(await db.conflict.toArray()).toEqual([expect.objectContaining(expected)]);
  });
});

describe('tombstones', () => {
  it('a newer tombstone deletes the local row', async () => {
    const local = stored(clientRow(at(1)), 0);
    await db.client.put(local);
    const deleted = { ...local, updated_at: at(2), deleted_at: at(2) };

    expect(await importOk(backupWith({ client: [deleted] }))).toEqual(counts({ deleted: 1 }));
    expect(await db.client.get(local.id)).toMatchObject({ deleted_at: at(2), pending: 1 });
  });

  it('an older tombstone does not delete a row edited since', async () => {
    const local = stored(clientRow(at(5)), 0);
    await db.client.put(local);
    const deleted = { ...local, updated_at: at(2), deleted_at: at(2) };

    expect(await importOk(backupWith({ client: [deleted] }))).toEqual(counts({ kept: 1 }));
    expect(await db.client.get(local.id)).toEqual(local);
  });

  it('a newer edit brings a deleted row back', async () => {
    const local = stored(clientRow(at(2), { deleted_at: at(2) }), 0);
    await db.client.put(local);
    const revived = { ...local, deleted_at: null, updated_at: at(3) };

    expect(await importOk(backupWith({ client: [revived] }))).toEqual(counts({ added: 1 }));
    expect(await db.client.get(local.id)).toMatchObject({ deleted_at: null, pending: 1 });
  });

  it('an older backup does not reopen a conflict resolved on this device', async () => {
    const open = {
      id: newId(),
      updated_at: at(1),
      deleted_at: null,
      server_version: 4,
      device_id: '00000000-0000-0000-0000-000000000000',
      table: 'client' as const,
      record_id: newId(),
      field: 'notes',
      losing_value: 'Texto que perdió',
      losing_device_id: OTHER_DEVICE,
      created_at: at(1),
      resolved: false,
    };
    await db.conflict.put(stored(open, 0));
    await repos.conflict.update(open.id, { resolved: true });

    expect(await importOk(backupWith({ conflict: [open] }))).toEqual(counts({ kept: 1 }));
    expect((await db.conflict.get(open.id))?.resolved).toBe(true);
  });
});

describe('seed rows', () => {
  const amethyst = seedId('crystal', 'amethyst');

  beforeEach(async () => {
    await loadSeed(db);
  });

  it('skips untouched seed rows in the file, even newer than her edit here', async () => {
    const edited = await repos.crystal.update(amethyst, {
      description: 'Mi descripción',
      user_modified: true,
    });
    const { pending, ...bundled } = { ...edited, user_modified: false, description: 'Seed' };
    const newer = { ...bundled, updated_at: '2026-12-01T00:00:00.000Z' };

    expect(await importOk(backupWith({ crystal: [newer] }))).toEqual(counts({ unchanged: 1 }));
    expect(await db.crystal.get(amethyst)).toEqual(edited);
  });

  it('her edited seed row replaces the untouched one here, kept verbatim even if older', async () => {
    const local = await db.crystal.get(amethyst);
    if (!local) throw new Error('no amethyst');
    const { pending, ...row } = local;
    const edited = {
      ...row,
      description: 'Editada en el otro dispositivo',
      user_modified: true,
      // Before this device's loader stamped its copy.
      updated_at: '2020-01-01T00:00:00.000Z',
      device_id: OTHER_DEVICE,
    };

    expect(await importOk(backupWith({ crystal: [edited] }))).toEqual(counts({ updated: 1 }));
    expect(await db.crystal.get(amethyst)).toEqual({ ...edited, pending: 1 });
  });

  it('an edited seed row here beats an older edited one from the file', async () => {
    const mine = await repos.crystal.update(amethyst, { hidden: true });
    const { pending, ...row } = mine;
    const older = { ...row, hidden: false, user_modified: true, updated_at: at(1) };

    expect(await importOk(backupWith({ crystal: [older] }))).toEqual(counts({ kept: 1 }));
    expect(await db.crystal.get(amethyst)).toEqual(mine);
  });

  it('imported edits survive the next seed update', async () => {
    const source = new ArcanaDB(`test-${crypto.randomUUID()}`);
    await loadSeed(source);
    const sourceRepos = createRepositories(source);
    await sourceRepos.crystal.update(amethyst, { description: 'Mía', user_modified: true });
    await sourceRepos.crystal.update(seedId('crystal', 'citrine'), { hidden: true });
    await sourceRepos.intention_tag.update(seedId('intention_tag', 'calm'), { label: 'Paz' });
    await sourceRepos.spread_template.remove(seedId('spread_template', 'horseshoe'));
    const backup = await exportOf(source);
    await source.delete();

    await importOk(backup);
    await loadSeed(db, {
      ...bundledSeed,
      spreads: { ...bundledSeed.spreads, version: bundledSeed.spreads.version + 1 },
      crystals: { ...bundledSeed.crystals, version: bundledSeed.crystals.version + 1 },
    });

    expect(await db.crystal.get(amethyst)).toMatchObject({ description: 'Mía' });
    expect(await db.crystal.get(seedId('crystal', 'citrine'))).toMatchObject({ hidden: true });
    expect(await db.intention_tag.get(seedId('intention_tag', 'calm'))).toMatchObject({
      label: 'Paz',
    });
    expect(
      (await db.spread_template.get(seedId('spread_template', 'horseshoe')))?.deleted_at,
    ).not.toBeNull();
  });
});

describe('foreign keys', () => {
  it('refuses a child whose parent is neither in the file nor on this device', async () => {
    const before = await everything(db);
    const orphan = sessionRow(newId(), at(1));

    expect(await applyImport(db, backupWith({ session: [orphan] }))).toEqual({
      ok: false,
      problem: { kind: 'missingParent', count: 1 },
    });
    expect(await previewImport(db, backupWith({ session: [orphan] }))).toEqual({
      ok: false,
      problem: { kind: 'missingParent', count: 1 },
    });
    expect(await everything(db)).toEqual(before);
  });

  it('accepts a parent stored on this device, even deleted', async () => {
    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);
    const session = sessionRow(client.id, at(1));

    expect(await importOk(backupWith({ session: [session] }))).toEqual(counts({ added: 1 }));
  });
});

describe('a failed import', () => {
  it('leaves every table exactly as it was when a write fails halfway', async () => {
    await loadSeed(db);
    const local = {
      ...(await repos.client.create(newClient({ name: 'Local' }))),
      updated_at: at(10),
    };
    await db.client.put(local);
    const client = clientRow(at(1));
    const session = sessionRow(client.id, at(2));
    const { pending, ...overwritten } = { ...local, name: 'Pisado', updated_at: at(50) };
    const backup = backupWith({
      client: [client, overwritten],
      session: [session],
      payment: [
        {
          id: newId(),
          updated_at: at(3),
          deleted_at: null,
          server_version: null,
          device_id: OTHER_DEVICE,
          session_id: session.id,
          client_id: client.id,
          amount_minor: 500,
          currency: 'CRC',
          method: 'cash',
          paid_at: '2026-10-20',
          reference: null,
          // IndexedDB can't store a function: the write fails after clients and sessions
          // (written first) are already in the transaction.
          note: (() => '') as unknown as string,
        },
      ],
    });
    const before = await everything(db);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await applyImport(db, backup)).toEqual({ ok: false, problem: { kind: 'failed' } });
    expect(error).toHaveBeenCalledWith('Import failed', expect.anything());
    expect(await everything(db)).toEqual(before);
    error.mockRestore();
  });
});

describe('preview and counts', () => {
  it('previews what the import then does, with the export date', async () => {
    const backup = backupWith({ client: [clientRow(at(1))] }, at(30));
    expect(await previewImport(db, backup)).toEqual({
      ok: true,
      counts: counts({ added: 1 }),
      exportedAt: at(30),
      futureRows: 0,
    });
    expect(await rowsIn(db, 'client')).toEqual([]);
    expect(await importOk(backup)).toEqual(counts({ added: 1 }));
  });

  it('reports what the write transaction did when data changed after the preview', async () => {
    const row = clientRow(at(1));
    const backup = backupWith({ client: [row] });
    expect(await previewImport(db, backup)).toMatchObject({ counts: counts({ added: 1 }) });

    // Synced in meanwhile, with a newer version.
    await db.client.put(stored({ ...row, updated_at: at(9), name: 'Más nuevo' }, 0));

    expect(await importOk(backup)).toEqual(counts({ kept: 1 }));
    expect((await db.client.get(row.id))?.name).toBe('Más nuevo');
  });
});

describe('dates ahead of the clock', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const ahead = '2026-10-23T12:00:00.000Z';

  it('counts rows more than 24 h ahead for the preview warning, and imports them', async () => {
    const backup = backupWith({
      client: [clientRow(ahead), clientRow('2026-10-22T11:00:00.000Z'), clientRow(at(1))],
    });
    expect(futureRows(backup, now)).toBe(1);
    expect(await previewImport(db, backup, now)).toMatchObject({ ok: true, futureRows: 1 });

    expect(await importOk(backup)).toEqual(counts({ added: 3 }));
    const [first] = backup.tables.client;
    expect((await db.client.get(first?.id ?? ''))?.updated_at).toBe(ahead);
  });

  it('sync stops with clock_ahead, and the manual retry re-stamps and pushes them', async () => {
    const server = new FakeSyncServer();
    server.now = () => now.getTime();
    await db.auth.put({ key: 'tokens', ...server.issueTokens() });
    const engine = createSyncEngine({
      db,
      api: server,
      locks: createLocalLocks(),
      clock: () => now.toISOString(),
    });
    const row = clientRow(ahead);
    await importOk(backupWith({ client: [row] }));

    expect((await engine.sync('open')).state).toBe('clock_ahead');
    expect((await engine.sync('manual')).state).toBe('idle');

    expect(server.get('client', row.id)?.updated_at).toBe(now.toISOString());
    expect(await db.client.get(row.id)).toMatchObject({
      updated_at: now.toISOString(),
      pending: 0,
    });
    expect((await readStatus(db)).state).toBe('idle');
  });
});

describe('with sync', () => {
  it('leaves exactly the written rows pending for the next push', async () => {
    const local = stored(clientRow(at(5)), 0);
    await db.client.put(local);
    const newer = clientRow(at(1));
    const older = { ...local, name: 'Viejo', updated_at: at(4) };

    await importOk(backupWith({ client: [newer, older] }));

    const { changes } = await readPending(db);
    expect(changes.map((change) => change.record.id)).toEqual([newer.id]);
  });

  it('a row rewritten by an import during a sync stays pending for the next push', async () => {
    const client = await repos.client.create(newClient());
    const { snapshot } = await readPending(db);
    const { pending, ...row } = client;
    await importOk(
      backupWith({
        client: [{ ...row, name: 'Del respaldo', updated_at: '2030-01-01T00:00:00.000Z' }],
      }),
    );

    await applyResponse(
      db,
      {
        results: [{ table: 'client', id: client.id, status: 'applied' }],
        conflicts: [],
        changes: [],
        cursor: 1,
        server_time: new Date().toISOString(),
        epoch: 'epoch-1',
      },
      snapshot,
    );

    expect(await db.client.get(client.id)).toMatchObject({ name: 'Del respaldo', pending: 1 });
  });
});

describe('readBackupFile', () => {
  it('refuses a file over the size limit without reading it', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    expect(await readBackupFile({ size: MAX_BACKUP_BYTES + 1, text })).toEqual({
      ok: false,
      problem: { kind: 'tooLarge' },
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('reads and validates a picked file', async () => {
    const backup = backupWith({ client: [clientRow(at(1))] });
    const file = new File([JSON.stringify(backup)], 'arcana-respaldo-2026-10-21.json');
    expect(await readBackupFile(file)).toEqual({ ok: true, backup });
  });
});
