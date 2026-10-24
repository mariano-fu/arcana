// The backup file (T1.13): every row of her data in one JSON file, versioned and validated with
// Zod (specs/plan.md, "Export / import").
//
// `format_version` covers the whole file. Any change to a row's fields (added, removed or
// retyped) means a new version: bump `FORMAT_VERSION`, add a step to `MIGRATIONS` that upgrades
// files of the previous version, and commit `formats/v<N>.json` (format.test.ts says how). The
// type checker ties the row schemas to `db/types.ts`, so a field added there can't be forgotten
// here, and the signature test then fails until the version is bumped.

import { z } from 'zod';

import type { SyncedTables } from '../../db';
import { spreadLayoutSchema } from '../../seed/spreads';
import { PUSH_ORDER, type PushableTable } from '../../sync/wire';
import { CURRENCIES } from '../payments/money';
import { PAYMENT_METHODS } from '../payments/form';
import { SESSION_TYPES } from '../sessions/form';

export const BACKUP_FORMAT = 'arcana-backup';
export const FORMAT_VERSION = 1;

/**
 * The tables a backup holds, parents first: every table sync pushes. Horoscopes are left out:
 * the server owns them and they can be fetched again.
 */
export const BACKUP_TABLES = PUSH_ORDER;
export type BackupTable = PushableTable;

/** A row as stored in a backup: the local row without `pending`, which import sets itself. */
export type BackupRow<T extends BackupTable> = Omit<SyncedTables[T], 'pending'>;
export type BackupTables = { [T in BackupTable]: BackupRow<T>[] };

export interface Backup {
  format: typeof BACKUP_FORMAT;
  format_version: typeof FORMAT_VERSION;
  /** The exporting device's Dexie schema version. Informational. */
  db_schema_version: number;
  app_version: string;
  exported_at: string;
  /** The exporting device. Informational: import never changes this device's id. */
  device_id: string | null;
  /** The seed versions loaded on the exporting device. Informational. */
  seed_versions: { spreads: number | null; crystals: number | null };
  tables: BackupTables;
}

const id = z.guid();
/** `YYYY-MM-DDTHH:MM:SS.sssZ`, as `toISOString()` writes it. */
const timestamp = z.iso.datetime({ precision: 3 });
const date = z.iso.date();
/** `HH:MM`. */
const time = z.iso.time({ precision: -1 });
const strings = z.array(z.string());

const synced = {
  id,
  updated_at: timestamp,
  deleted_at: timestamp.nullable(),
  server_version: z.int().min(0).nullable(),
  device_id: id,
};

const positionSchema = z.strictObject({
  index: z.int().min(1),
  name: z.string(),
  meaning: z.string(),
  layout: spreadLayoutSchema.nullable(),
});

export const rowSchemas = {
  client: z.strictObject({
    ...synced,
    name: z.string(),
    instagram: z.string().nullable(),
    whatsapp: z.string().nullable(),
    email: z.string().nullable(),
    birth_date: date.nullable(),
    birth_time: time.nullable(),
    birth_place_label: z.string().nullable(),
    birth_lat: z.number().min(-90).max(90).nullable(),
    birth_lng: z.number().min(-180).max(180).nullable(),
    birth_tz: z.string().nullable(),
    notes: z.string(),
    tags: strings,
    archived: z.boolean(),
    created_at: timestamp,
  }),
  session: z.strictObject({
    ...synced,
    client_id: id,
    started_at: timestamp,
    type: z.enum(SESSION_TYPES),
    price_minor: z.int().min(0).nullable(),
    currency: z.enum(CURRENCIES),
    notes: z.string(),
    follow_up_note: z.string(),
    follow_up_date: date.nullable(),
  }),
  payment: z.strictObject({
    ...synced,
    session_id: id,
    client_id: id,
    amount_minor: z.int(),
    currency: z.enum(CURRENCIES),
    method: z.enum(PAYMENT_METHODS),
    paid_at: date,
    reference: z.string().nullable(),
    note: z.string(),
  }),
  reading: z.strictObject({
    ...synced,
    session_id: id,
    spread_template_id: id,
    spread_snapshot: z.strictObject({ name: z.string(), positions: z.array(positionSchema) }),
    label: z.string().nullable(),
    created_at: timestamp,
  }),
  card_draw: z.strictObject({
    ...synced,
    reading_id: id,
    position_index: z.int().min(1),
    card_id: z.string(),
    reversed: z.boolean(),
    note: z.string(),
  }),
  spread_template: z.strictObject({
    ...synced,
    name: z.string(),
    description: z.string(),
    positions: z.array(positionSchema),
    is_seed: z.boolean(),
    seed_key: z.string().nullable(),
  }),
  crystal: z.strictObject({
    ...synced,
    seed_key: z.string().nullable(),
    name: z.string(),
    colors: strings,
    chakras: strings,
    signs: strings,
    intentions: strings,
    description: z.string(),
    care: z.string(),
    hidden: z.boolean(),
    user_modified: z.boolean(),
  }),
  intention_tag: z.strictObject({
    ...synced,
    key: z.string(),
    label: z.string().nullable(),
  }),
  card_note: z.strictObject({
    ...synced,
    card_id: z.string(),
    note: z.string(),
  }),
  conflict: z.strictObject({
    ...synced,
    table: z.enum([
      'client',
      'session',
      'payment',
      'reading',
      'card_draw',
      'spread_template',
      'crystal',
      'intention_tag',
      'card_note',
      'conflict',
      'horoscope',
    ]),
    record_id: id,
    field: z.string(),
    losing_value: z.string().nullable(),
    losing_device_id: id,
    created_at: timestamp,
    resolved: z.boolean(),
  }),
} satisfies Record<BackupTable, z.ZodType>;

export const backupSchema = z
  .strictObject({
    format: z.literal(BACKUP_FORMAT),
    format_version: z.literal(FORMAT_VERSION),
    db_schema_version: z.int().positive(),
    app_version: z.string(),
    exported_at: timestamp,
    device_id: id.nullable(),
    seed_versions: z.strictObject({
      spreads: z.int().nullable(),
      crystals: z.int().nullable(),
    }),
    tables: z.strictObject({
      client: z.array(rowSchemas.client),
      session: z.array(rowSchemas.session),
      payment: z.array(rowSchemas.payment),
      reading: z.array(rowSchemas.reading),
      card_draw: z.array(rowSchemas.card_draw),
      spread_template: z.array(rowSchemas.spread_template),
      crystal: z.array(rowSchemas.crystal),
      intention_tag: z.array(rowSchemas.intention_tag),
      card_note: z.array(rowSchemas.card_note),
      conflict: z.array(rowSchemas.conflict),
    }),
  })
  .superRefine((backup, ctx) => {
    for (const table of BACKUP_TABLES) {
      const seen = new Set<string>();
      backup.tables[table].forEach((row, index) => {
        if (seen.has(row.id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Duplicate id',
            path: ['tables', table, index, 'id'],
          });
        }
        seen.add(row.id);
      });
    }
  });

/**
 * Upgrades a file of format N to N + 1, keyed by N: one step per version below
 * `FORMAT_VERSION`. Empty while version 1 is the only one.
 */
export const MIGRATIONS: Readonly<Partial<Record<number, (file: object) => object>>> = {};

/** Why a file can't be imported (or an export can't be shared). Each has a Spanish message. */
export type BackupProblem =
  | { kind: 'notJson' }
  | { kind: 'notBackup' }
  | { kind: 'futureVersion' }
  | { kind: 'unknownVersion' }
  | { kind: 'invalid'; count: number }
  | { kind: 'missingParent'; count: number }
  | { kind: 'tooLarge' }
  | { kind: 'failed' };

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; problem: BackupProblem };

/**
 * Reads and validates a backup file's text, upgrading older formats first. Never throws. The
 * issues of an invalid file are logged as paths and codes only, never values: they are her
 * clients' data.
 */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: { kind: 'notJson' } };
  }
  if (typeof json !== 'object' || json === null || !('format' in json)) {
    return { ok: false, problem: { kind: 'notBackup' } };
  }
  if (json.format !== BACKUP_FORMAT) return { ok: false, problem: { kind: 'notBackup' } };

  const version = 'format_version' in json ? json.format_version : undefined;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, problem: { kind: 'unknownVersion' } };
  }
  if (version > FORMAT_VERSION) return { ok: false, problem: { kind: 'futureVersion' } };

  let file: object = json;
  for (let from = version; from < FORMAT_VERSION; from++) {
    const step = MIGRATIONS[from];
    if (!step) return { ok: false, problem: { kind: 'unknownVersion' } };
    file = step(file);
  }

  const result = backupSchema.safeParse(file);
  if (!result.success) {
    console.warn(
      'Backup file rejected',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    );
    return { ok: false, problem: { kind: 'invalid', count: result.error.issues.length } };
  }
  return { ok: true, backup: result.data };
}

/** A foreign key in a backup row, by the child's table and field. */
export interface ParentRef {
  table: BackupTable;
  id: string;
  parentTable: 'client' | 'session' | 'reading';
  parentId: string;
}

/**
 * Every foreign key the server checks: a row pushed with a missing parent stops sync, so a
 * backup must not bring one in. `reading.spread_template_id` is a plain reference everywhere.
 */
export function parentRefs(tables: BackupTables): ParentRef[] {
  const refs: ParentRef[] = [];
  for (const row of tables.session) {
    refs.push({ table: 'session', id: row.id, parentTable: 'client', parentId: row.client_id });
  }
  for (const row of tables.payment) {
    refs.push({ table: 'payment', id: row.id, parentTable: 'session', parentId: row.session_id });
    refs.push({ table: 'payment', id: row.id, parentTable: 'client', parentId: row.client_id });
  }
  for (const row of tables.reading) {
    refs.push({ table: 'reading', id: row.id, parentTable: 'session', parentId: row.session_id });
  }
  for (const row of tables.card_draw) {
    refs.push({ table: 'card_draw', id: row.id, parentTable: 'reading', parentId: row.reading_id });
  }
  return refs;
}

/** The foreign keys whose parent is not in the file itself. */
export function parentsOutsideFile(tables: BackupTables): ParentRef[] {
  const ids = {
    client: new Set(tables.client.map((row) => row.id)),
    session: new Set(tables.session.map((row) => row.id)),
    reading: new Set(tables.reading.map((row) => row.id)),
  };
  return parentRefs(tables).filter((ref) => !ids[ref.parentTable].has(ref.parentId));
}
