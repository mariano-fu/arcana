// The backup format: its drift guards and what `parseBackup` refuses.
//
// Two guards keep `format_version` honest:
// - `Checks` (type level, `npm run typecheck`): the row schemas match `db/types.ts` exactly, so a
//   field added to a table can't be left out of backups.
// - the signature test: the fields and types of the current format are committed in
//   `formats/v<FORMAT_VERSION>.json`. Changing the schema without bumping the version fails it.
//   To make a new version: bump `FORMAT_VERSION`, add `MIGRATIONS[<old version>]` (with a test
//   that upgrades an old file), and commit the new `formats/v<N>.json` (the failure prints it).
//   Old signature files stay, one per version the import still reads.

import { z } from 'zod';

import {
  BACKUP_TABLES,
  backupSchema,
  FORMAT_VERSION,
  MIGRATIONS,
  parseBackup,
  rowSchemas,
  type Backup,
  type BackupRow,
} from './format';
import { asVersion1, at, backupWith, clientRow, sessionRow } from './test-utils';

/** True when A and B have the same keys and are assignable both ways. */
type Exact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;
type Assert<T extends true> = T;
type Row<T extends keyof typeof rowSchemas> = Exact<z.infer<(typeof rowSchemas)[T]>, BackupRow<T>>;

export type Checks = [
  Assert<Row<'client'>>,
  Assert<Row<'session'>>,
  Assert<Row<'payment'>>,
  Assert<Row<'reading'>>,
  Assert<Row<'card_draw'>>,
  Assert<Row<'spread_template'>>,
  Assert<Row<'crystal'>>,
  Assert<Row<'intention_tag'>>,
  Assert<Row<'card_note'>>,
  Assert<Row<'session_crystal'>>,
  Assert<Row<'conflict'>>,
  Assert<Exact<z.infer<typeof backupSchema>, Backup>>,
];

type Signature = string | { [key: string]: Signature };

interface JsonSchema {
  type?: string | string[];
  format?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

/** Each field's JSON type, without patterns or bounds, which a Zod upgrade could reword. */
function signature(schema: JsonSchema): Signature {
  if (schema.anyOf) {
    const members = schema.anyOf.map(signature);
    return members.every((member) => typeof member === 'string')
      ? members.join(' | ')
      : Object.fromEntries(members.map((member, i) => [`anyOf ${String(i)}`, member]));
  }
  if ('const' in schema) return `const ${JSON.stringify(schema.const)}`;
  if (schema.enum) return `enum ${schema.enum.map((value) => JSON.stringify(value)).join(' ')}`;
  if (schema.type === 'object') {
    const required = new Set(schema.required);
    return Object.fromEntries(
      Object.keys(schema.properties ?? {})
        .sort()
        .map((key) => [
          required.has(key) ? key : `${key}?`,
          signature(schema.properties?.[key] ?? {}),
        ]),
    );
  }
  if (schema.type === 'array') {
    const items = signature(schema.items ?? {});
    return typeof items === 'string' ? `${items}[]` : { '[]': items };
  }
  if (schema.type === 'string' && schema.format) return `string (${schema.format})`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type ?? 'any';
}

export const formatSignature = () => signature(z.toJSONSchema(backupSchema) as JsonSchema);

const committed = import.meta.glob<Signature>('./formats/v*.json', {
  eager: true,
  import: 'default',
});
const committedVersion = (path: string) => Number(/v(\d+)\.json$/.exec(path)?.[1]);

describe('format version', () => {
  it('matches the committed signature of the current version', () => {
    const current = committed[`./formats/v${String(FORMAT_VERSION)}.json`];
    expect(
      current,
      `formats/v${String(FORMAT_VERSION)}.json is missing; commit this signature:\n${JSON.stringify(formatSignature(), null, 2)}`,
    ).toBeDefined();
    expect(
      formatSignature(),
      'The backup format changed: bump FORMAT_VERSION, add a migration and commit the new signature (see this file)',
    ).toEqual(current);
  });

  it('has a migration from every older version it can read', () => {
    const versions = Object.keys(committed).map(committedVersion);
    expect(versions).toContain(FORMAT_VERSION);
    for (const version of versions.filter((v) => v < FORMAT_VERSION)) {
      expect(MIGRATIONS[version], `MIGRATIONS[${String(version)}]`).toBeTypeOf('function');
    }
    expect(Math.max(...versions)).toBe(FORMAT_VERSION);
  });

  it('holds every table sync pushes, and not horoscopes', () => {
    expect(Object.keys(backupWith({}).tables).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(BACKUP_TABLES).not.toContain('horoscope');
  });
});

describe('parseBackup', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const valid = () => {
    const client = clientRow(at(1));
    return backupWith({ client: [client], session: [sessionRow(client.id, at(2))] });
  };
  const text = (value: unknown) => JSON.stringify(value);
  const problem = (input: string) => {
    const parsed = parseBackup(input);
    return parsed.ok ? null : parsed.problem;
  };

  it('accepts a valid file', () => {
    const backup = valid();
    expect(parseBackup(text(backup))).toEqual({ ok: true, backup });
  });

  it.each([['{'], [''], ['hola']])('refuses text that is not JSON: %j', (input) => {
    expect(problem(input)).toEqual({ kind: 'notJson' });
  });

  it.each([[[]], [null], [42], [{}], [{ format: 'otra-app', format_version: 1 }]])(
    'refuses JSON that is not an Arcana backup: %j',
    (value) => {
      expect(problem(text(value))).toEqual({ kind: 'notBackup' });
    },
  );

  it('refuses a newer format version', () => {
    expect(problem(text({ ...valid(), format_version: FORMAT_VERSION + 1 }))).toEqual({
      kind: 'futureVersion',
    });
  });

  it.each([[0], [-1], [1.5], ['1'], [null], [undefined]])(
    'refuses an unknown format version: %j',
    (version) => {
      expect(problem(text({ ...valid(), format_version: version }))).toEqual({
        kind: 'unknownVersion',
      });
    },
  );

  it.each<[string, (backup: Backup) => unknown]>([
    ['an unknown field', (b) => ({ ...b, extra: true })],
    [
      'an unknown row field',
      (b) => ({ ...b, tables: { ...b.tables, client: [{ ...b.tables.client[0], pending: 1 }] } }),
    ],
    [
      'a fractional amount',
      (b) => ({
        ...b,
        tables: { ...b.tables, session: [{ ...b.tables.session[0], price_minor: 15000.5 }] },
      }),
    ],
    [
      'a bad id',
      (b) => ({ ...b, tables: { ...b.tables, client: [{ ...b.tables.client[0], id: 'abc' }] } }),
    ],
    [
      'a timestamp without milliseconds',
      (b) => ({
        ...b,
        tables: {
          ...b.tables,
          client: [{ ...b.tables.client[0], updated_at: '2026-10-20T12:00:00Z' }],
        },
      }),
    ],
    [
      'an unknown currency',
      (b) => ({
        ...b,
        tables: { ...b.tables, session: [{ ...b.tables.session[0], currency: 'EUR' }] },
      }),
    ],
    ['a missing table', (b) => ({ ...b, tables: { ...b.tables, payment: undefined } })],
    [
      'a duplicate id',
      (b) => ({ ...b, tables: { ...b.tables, client: [b.tables.client[0], b.tables.client[0]] } }),
    ],
  ])('refuses %s as invalid', (_, change) => {
    expect(problem(text(change(valid())))).toEqual({ kind: 'invalid', count: 1 });
  });

  it('reads a version 1 file as version 2 with no attached crystals', () => {
    const backup = valid();

    // Everything else as in the file, whose device ran Dexie schema 2.
    expect(parseBackup(text(asVersion1(backup)))).toEqual({
      ok: true,
      backup: { ...backup, db_schema_version: 2 },
    });
    expect(backup.tables.session_crystal).toEqual([]);
  });

  it('refuses a version 1 file whose tables are not an object as invalid', () => {
    expect(problem(text({ ...asVersion1(valid()), tables: 42 }))).toEqual({
      kind: 'invalid',
      count: 1,
    });
  });

  it('refuses an attached crystal with a bad crystal id as invalid', () => {
    const backup = valid();
    const session = backup.tables.session[0];
    if (!session) throw new Error('session missing');
    const attached = {
      id: crypto.randomUUID(),
      updated_at: at(3),
      deleted_at: null,
      server_version: null,
      device_id: session.device_id,
      session_id: session.id,
      crystal_id: 'rose-quartz',
    };
    const file = { ...backup, tables: { ...backup.tables, session_crystal: [attached] } };
    expect(problem(text(file))).toEqual({ kind: 'invalid', count: 1 });
  });

  it('logs where a file is invalid, never its values', () => {
    const warn = vi.mocked(console.warn);
    const backup = valid();
    const client = { ...backup.tables.client[0], name: 'Valor privado', archived: 'sí' };
    parseBackup(text({ ...backup, tables: { ...backup.tables, client: [client] } }));
    expect(warn).toHaveBeenCalledWith('Backup file rejected', [
      { path: 'tables.client.0.archived', code: 'invalid_type' },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Valor privado|sí/);
  });
});
