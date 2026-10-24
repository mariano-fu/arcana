import { newSession } from '../clients/test-utils';
import { ArcanaDB, createRepositories, getDeviceId, newId } from '../../db';
import { loadSeed, SEED_VERSION_KEYS } from '../../seed/loader';
import { CURSOR_KEY, EPOCH_KEY, STATUS_KEY } from '../../sync/status';
import { useTimeZone } from '../../test/time-zone';
import { localDate, readBackup, toExportFile } from './export';
import { BACKUP_TABLES, FORMAT_VERSION, parseBackup, type BackupTables } from './format';
import { applyImport } from './import';
import { at, backupTables, clientRow, exportOf, fillDb, stored } from './test-utils';

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('readBackup', () => {
  it('holds every row of every table, deleted ones too, without pending', async () => {
    await fillDb(db);
    const backup = await exportOf(db);

    for (const table of BACKUP_TABLES) {
      const rows = await db.table(table).toArray();
      expect(backup.tables[table], table).toHaveLength(rows.length);
    }
    expect(backup.tables.client.some((row) => row.deleted_at !== null)).toBe(true);
    expect(backup.tables.session.some((row) => row.deleted_at === null)).toBe(true);
    expect(JSON.stringify(backup)).not.toContain('"pending"');
  });

  it('records the format, versions and this device, and leaves out login and sync state', async () => {
    await fillDb(db);
    await db.auth.put({ key: 'tokens', access: 'secret-access', refresh: 'secret-refresh' });
    await db.meta.bulkPut([
      { key: CURSOR_KEY, value: '42' },
      { key: EPOCH_KEY, value: 'epoch-xyz' },
      { key: STATUS_KEY, value: '{"state":"idle"}' },
    ]);
    const file = toExportFile(await readBackup(db, '0.1.0'), new Date('2026-10-21T15:00:00.000Z'));
    if (!file.ok) throw new Error(file.problem.kind);

    const backup = JSON.parse(file.text) as Record<string, unknown>;
    expect(backup).toMatchObject({
      format: 'arcana-backup',
      format_version: FORMAT_VERSION,
      db_schema_version: db.verno,
      app_version: '0.1.0',
      exported_at: '2026-10-21T15:00:00.000Z',
      device_id: await getDeviceId(db),
      seed_versions: {
        spreads: Number((await db.meta.get(SEED_VERSION_KEYS.spreads))?.value),
        crystals: Number((await db.meta.get(SEED_VERSION_KEYS.crystals))?.value),
      },
    });
    expect(Object.keys(backup.tables as object).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(file.text).not.toMatch(/secret-access|secret-refresh|epoch-xyz|sync:|horoscope"/);
  });

  it('exports an empty device', async () => {
    const backup = await exportOf(db);
    expect(backup.device_id).toBeNull();
    expect(backup.seed_versions).toEqual({ spreads: null, crystals: null });
  });
});

describe('the export self-check', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to hand out a backup with a row the import would reject', async () => {
    await db.client.put(stored({ ...clientRow(at(1)), archived: 'no' as unknown as boolean }));
    expect(toExportFile(await readBackup(db, '0.1.0'), new Date())).toEqual({
      ok: false,
      problem: { kind: 'invalid', count: 1 },
    });
  });

  it('refuses to hand out a backup with a row whose parent is missing', async () => {
    const repos = createRepositories(db);
    await repos.session.create(newSession(newId()));
    expect(toExportFile(await readBackup(db, '0.1.0'), new Date())).toEqual({
      ok: false,
      problem: { kind: 'missingParent', count: 1 },
    });
  });

  it('passes on a full database, and the file it checked is the one shared', async () => {
    await fillDb(db);
    const file = toExportFile(await readBackup(db, '0.1.0'), new Date());
    expect(file.ok).toBe(true);
    if (file.ok) expect(parseBackup(file.text).ok).toBe(true);
  });
});

describe('localDate', () => {
  useTimeZone('America/Costa_Rica');

  it('names the file by the device’s calendar date', () => {
    // 21:30 on the 21st in Costa Rica is already the 22nd in UTC.
    expect(localDate(new Date('2026-10-22T03:30:00.000Z'))).toBe('2026-10-21');
  });
});

describe('export → wipe → import', () => {
  /** Untouched seed rows come from each device's own loader: compared on content only. */
  function comparable(tables: BackupTables) {
    const strip = <R extends { updated_at: string; device_id: string }>(row: R) => {
      const { updated_at, device_id, ...content } = row;
      return content;
    };
    return {
      ...tables,
      spread_template: tables.spread_template.map((row) =>
        row.is_seed && row.deleted_at === null ? strip(row) : row,
      ),
      crystal: tables.crystal.map((row) =>
        row.seed_key !== null && !row.user_modified && !row.hidden && row.deleted_at === null
          ? strip(row)
          : row,
      ),
      intention_tag: tables.intention_tag.map((row) =>
        row.label === null && row.deleted_at === null ? strip(row) : row,
      ),
    };
  }

  it('gives back identical data', async () => {
    const name = db.name;
    await fillDb(db);
    const before = await backupTables(db);
    const backup = await exportOf(db);

    await db.delete();
    db = new ArcanaDB(name);
    await loadSeed(db);
    const result = await applyImport(db, backup);

    expect(result.ok).toBe(true);
    expect(comparable(await backupTables(db))).toEqual(comparable(before));
    // Everything imported is pushed on the next sync; nothing else of the other device came along.
    expect(await db.client.where('pending').equals(0).count()).toBe(0);
    expect(await db.meta.get(CURSOR_KEY)).toBeUndefined();
    expect(await db.meta.get(EPOCH_KEY)).toBeUndefined();
    expect((await db.meta.get('device_id'))?.value).not.toBe(backup.device_id);
    expect(await db.auth.count()).toBe(0);
    await exportOf(db);
  });

  it('a second round trip changes nothing', async () => {
    await fillDb(db);
    const backup = await exportOf(db);
    const before = await backupTables(db);

    const result = await applyImport(db, backup);

    const rows = BACKUP_TABLES.reduce((sum, table) => sum + backup.tables[table].length, 0);
    expect(result).toEqual({
      ok: true,
      counts: { added: 0, updated: 0, deleted: 0, kept: 0, unchanged: rows },
    });
    expect(await backupTables(db)).toEqual(before);
  });

  it('merges another device’s data without duplicates', async () => {
    const other = new ArcanaDB(`test-${crypto.randomUUID()}`);
    await fillDb(other);
    const theirs = await exportOf(other);
    await other.delete();
    await fillDb(db);
    const mine = await backupTables(db);

    expect((await applyImport(db, theirs)).ok).toBe(true);
    expect((await applyImport(db, theirs)).ok).toBe(true);

    const merged = await backupTables(db);
    for (const table of ['client', 'session', 'payment', 'reading', 'card_draw'] as const) {
      // Both devices' own rows, once each.
      expect(merged[table], table).toHaveLength(mine[table].length + theirs.tables[table].length);
    }
    // Seed rows have the same ids on every device: one row each.
    expect(merged.crystal).toHaveLength(mine.crystal.length);
    for (const table of BACKUP_TABLES) {
      const ids = merged[table].map((row) => row.id);
      expect(new Set(ids).size, table).toBe(ids.length);
    }
  });
});
