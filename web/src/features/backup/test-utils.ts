// Backup test helpers: rows built by hand, a database holding a bit of everything, and the
// export self-check every backup test runs on the databases it builds. Fake data only.

import { newClient, newPayment, newSession } from '../clients/test-utils';
import {
  createRepositories,
  newId,
  type ArcanaDB,
  type Client,
  type Session,
  type SyncedTables,
} from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { readBackup, toExportFile } from './export';
import {
  BACKUP_FORMAT,
  FORMAT_VERSION,
  parseBackup,
  type Backup,
  type BackupRow,
  type BackupTables,
} from './format';

/** Stands in for the device id of the device that exported a file. */
export const OTHER_DEVICE = '0192f1a0-0000-7000-8000-00000000d0e1';

export const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 12, minute)).toISOString();

export function emptyTables(): BackupTables {
  return {
    client: [],
    spread_template: [],
    crystal: [],
    intention_tag: [],
    card_note: [],
    session: [],
    session_crystal: [],
    payment: [],
    reading: [],
    card_draw: [],
    conflict: [],
  };
}

export function backupWith(tables: Partial<BackupTables>, exportedAt = at(59)): Backup {
  return {
    format: BACKUP_FORMAT,
    format_version: FORMAT_VERSION,
    db_schema_version: 3,
    app_version: '0.1.0',
    exported_at: exportedAt,
    device_id: OTHER_DEVICE,
    seed_versions: { spreads: 1, crystals: 1 },
    tables: { ...emptyTables(), ...tables },
  };
}

const syncedFields = (updatedAt: string) => ({
  id: newId(),
  updated_at: updatedAt,
  deleted_at: null,
  server_version: null,
  device_id: OTHER_DEVICE,
});

export function clientRow(updatedAt: string, fields: Partial<Client> = {}): BackupRow<'client'> {
  return { ...newClient(), ...syncedFields(updatedAt), ...fields };
}

export function sessionRow(
  clientId: string,
  updatedAt: string,
  fields: Partial<Session> = {},
): BackupRow<'session'> {
  return { ...newSession(clientId), ...syncedFields(updatedAt), ...fields };
}

/**
 * The same backup as a format 1 file (before T2.9): no `session_crystal` table, and no
 * `session_crystal` value in the conflict table enum.
 */
export function asVersion1(backup: Backup): object {
  const { session_crystal, ...tables } = backup.tables;
  if (session_crystal.length > 0) throw new Error('a v1 file has no attached crystals');
  return { ...backup, format_version: 1, db_schema_version: 2, tables };
}

/** As stored on this device: the backup row plus `pending`. */
export const stored = <R>(row: R, pending: 0 | 1 = 0) => ({ ...row, pending });

/**
 * A database with a bit of everything: clients with sessions, payments, a reading with draws,
 * attached crystals (one detached), notes, a deleted client, a row pulled from the server, a custom spread, and every kind of
 * seed edit (edited, hidden, renamed, own tag, deleted seed spread), plus a conflict copy.
 */
export async function fillDb(db: ArcanaDB): Promise<void> {
  await loadSeed(db);
  const repos = createRepositories(db);

  const client = await repos.client.create(
    newClient({ name: 'Cliente Respaldo', notes: 'Prefiere lecturas por la tarde.' }),
  );
  const session = await repos.session.create(
    newSession(client.id, { price_minor: 1_500_000, notes: 'Sesión de prueba' }),
  );
  await repos.payment.create(newPayment(session, { amount_minor: 1_000_000 }));
  const spreadId = seedId('spread_template', 'three-card');
  const spread = await db.spread_template.get(spreadId);
  if (!spread) throw new Error('three-card seed spread missing');
  const reading = await repos.reading.create({
    session_id: session.id,
    spread_template_id: spreadId,
    spread_snapshot: { name: spread.name, positions: spread.positions },
    label: null,
    created_at: at(5),
  });
  for (const index of [1, 2, 3]) {
    await repos.card_draw.create({
      reading_id: reading.id,
      position_index: index,
      card_id: `major-0${String(index)}`,
      reversed: index === 2,
      note: index === 1 ? 'Nota de la carta' : '',
    });
  }
  await repos.card_note.create({ card_id: 'major-00', note: 'Mi nota personal' });
  await repos.session_crystal.create({
    session_id: session.id,
    crystal_id: seedId('crystal', 'rose-quartz'),
  });
  const detached = await repos.session_crystal.create({
    session_id: session.id,
    crystal_id: seedId('crystal', 'amethyst'),
  });
  await repos.session_crystal.remove(detached.id);
  await repos.conflict.create({
    table: 'client',
    record_id: client.id,
    field: 'notes',
    losing_value: 'Texto que perdió',
    losing_device_id: OTHER_DEVICE,
    created_at: at(6),
    resolved: false,
  });

  const gone = await repos.client.create(newClient({ name: 'Cliente Borrado' }));
  await repos.session.create(newSession(gone.id));
  await repos.client.remove(gone.id);

  // As if pulled from the server.
  await db.client.put({
    ...clientRow(at(1), { name: 'Cliente Sincronizado' }),
    server_version: 12,
    pending: 0,
  });

  await repos.spread_template.create({
    name: 'Mi tirada',
    description: '',
    positions: [{ index: 1, name: 'Hoy', meaning: '', layout: null }],
    is_seed: false,
    seed_key: null,
  });
  await repos.spread_template.remove(seedId('spread_template', 'horseshoe'));
  await repos.crystal.update(seedId('crystal', 'amethyst'), {
    description: 'Mi propia descripción.',
    user_modified: true,
  });
  await repos.crystal.update(seedId('crystal', 'citrine'), { hidden: true });
  await repos.intention_tag.update(seedId('intention_tag', 'calm'), { label: 'Paz' });
  await repos.intention_tag.create({ key: 'mi-intencion', label: 'Mi intención' });
}

/** Every row of every backup table, sorted by id, as `readBackup` returns them. */
export async function backupTables(db: ArcanaDB): Promise<BackupTables> {
  return (await readBackup(db, 'test')).tables;
}

/** The backup this device would share now; fails the test if the export self-check fails. */
export async function exportOf(db: ArcanaDB, now = new Date()): Promise<Backup> {
  const file = toExportFile(await readBackup(db, '0.1.0'), now);
  if (!file.ok) throw new Error(`export self-check failed: ${file.problem.kind}`);
  const parsed = parseBackup(file.text);
  if (!parsed.ok) throw new Error(`export not importable: ${parsed.problem.kind}`);
  return parsed.backup;
}

/** Rows of one table straight from IndexedDB, `pending` included. */
export function rowsIn<T extends keyof SyncedTables>(db: ArcanaDB, table: T) {
  return db.table<SyncedTables[T], string>(table).toArray();
}
