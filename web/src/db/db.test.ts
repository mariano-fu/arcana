import { ArcanaDB, SCHEMA_V1 } from './db';
import { getDeviceId } from './device';

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('schema v1', () => {
  it('creates every synced table plus meta', async () => {
    await db.open();

    expect(db.verno).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(Object.keys(SCHEMA_V1).sort());
  });

  it('indexes pending and server_version on every synced table', async () => {
    await db.open();

    for (const table of db.tables.filter((t) => t.name !== 'meta')) {
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
