import { Dexie } from 'dexie';

import { ArcanaDB, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SYNCED_TABLE_NAMES } from './db';
import { getDeviceId } from './device';
import { HardDeleteError } from './monotonic';

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('schema', () => {
  it('creates every synced table plus meta and auth', async () => {
    await db.open();

    expect(db.verno).toBe(3);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [...Object.keys(SCHEMA_V1), ...Object.keys(SCHEMA_V2), ...Object.keys(SCHEMA_V3)].sort(),
    );
  });

  it('upgrades a v1 database to the current version keeping every row', async () => {
    const v1 = new Dexie(db.name);
    v1.version(1).stores(SCHEMA_V1);
    const row = {
      id: 'c1',
      updated_at: '2026-10-20T12:00:00.000Z',
      deleted_at: null,
      server_version: 4,
      device_id: 'd1',
      pending: 1,
      name: 'Cliente de prueba',
    };
    await v1.table('client').put(row);
    await v1.table('meta').bulkPut([
      { key: 'device_id', value: 'd1' },
      { key: 'seed_version:spreads', value: '3' },
    ]);
    v1.close();

    await db.open();

    expect(db.verno).toBe(3);
    expect(await db.client.toArray()).toEqual([row]);
    expect(await db.meta.toArray()).toEqual([
      { key: 'device_id', value: 'd1' },
      { key: 'seed_version:spreads', value: '3' },
    ]);
    expect(await db.auth.count()).toBe(0);
  });

  it('upgrades a v2 database to v3 keeping every row of every table', async () => {
    const v2 = new Dexie(db.name);
    v2.version(1).stores(SCHEMA_V1);
    v2.version(2).stores(SCHEMA_V2);
    const synced = Object.keys(SCHEMA_V1).filter((name) => name !== 'meta');
    const rowOf = (table: string) => ({
      id: `${table}-1`,
      updated_at: '2026-10-20T12:00:00.000Z',
      deleted_at: null,
      server_version: 7,
      device_id: 'd1',
      pending: 1,
      // A field per table, so a row that came back empty would show.
      note: `fila de ${table}`,
    });
    const tombstone = (table: string) => ({
      ...rowOf(table),
      id: `${table}-2`,
      deleted_at: '2026-10-20T12:05:00.000Z',
      pending: 0,
    });
    for (const table of synced) await v2.table(table).bulkPut([rowOf(table), tombstone(table)]);
    const meta = [
      { key: 'device_id', value: 'd1' },
      { key: 'seed_version:crystals', value: '2' },
      { key: 'sync:cursor', value: '42' },
    ];
    await v2.table('meta').bulkPut(meta);
    const tokens = { key: 'tokens', access: 'a', refresh: 'r' };
    await v2.table('auth').put(tokens);
    v2.close();

    await db.open();

    expect(db.verno).toBe(3);
    for (const table of synced) {
      expect(await db.table(table).toArray(), table).toEqual([rowOf(table), tombstone(table)]);
    }
    expect(await db.meta.toArray()).toEqual(meta);
    expect(await db.auth.toArray()).toEqual([tokens]);
    expect(await db.session_crystal.count()).toBe(0);
  });

  it('treats session_crystal as synced: it refuses hard deletes', async () => {
    await db.open();

    expect(SYNCED_TABLE_NAMES.has('session_crystal')).toBe(true);
    await expect(db.session_crystal.delete('any')).rejects.toBeInstanceOf(HardDeleteError);
    await expect(db.session_crystal.clear()).rejects.toBeInstanceOf(HardDeleteError);
  });

  it('indexes pending and server_version on every synced table', async () => {
    await db.open();

    for (const table of db.tables.filter((t) => t.name !== 'meta' && t.name !== 'auth')) {
      const indexes = table.schema.indexes.map((i) => i.name);
      expect(table.schema.primKey.name, table.name).toBe('id');
      expect(indexes, table.name).toEqual(expect.arrayContaining(['pending', 'server_version']));
    }
  });
});

describe('getDeviceId', () => {
  it('creates the id once and persists it across connections', async () => {
    const [a, b] = await Promise.all([getDeviceId(db), getDeviceId(db)]);
    expect(a).toBe(b);

    const reopened = new ArcanaDB(db.name);
    expect(await getDeviceId(reopened)).toBe(a);
    reopened.close();
  });
});
