import { Dexie } from 'dexie';

import { ArcanaDB, SCHEMA_V1, SCHEMA_V2 } from './db';
import { getDeviceId } from './device';

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

    expect(db.verno).toBe(2);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [...Object.keys(SCHEMA_V1), ...Object.keys(SCHEMA_V2)].sort(),
    );
  });

  it('upgrades a v1 database to v2 keeping every row', async () => {
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

    expect(db.verno).toBe(2);
    expect(await db.client.toArray()).toEqual([row]);
    expect(await db.meta.toArray()).toEqual([
      { key: 'device_id', value: 'd1' },
      { key: 'seed_version:spreads', value: '3' },
    ]);
    expect(await db.auth.count()).toBe(0);
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
