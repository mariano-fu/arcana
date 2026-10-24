// Type-level drift check between the server's API (`api.gen.ts`, generated from
// api/openapi.yaml) and the local row types in `db/types.ts`. `npm run typecheck` fails
// if a synced table gains, loses or retypes a field on one side only.

import type {
  CardDraw,
  CardNote,
  Client,
  Conflict,
  Crystal,
  Horoscope,
  IntentionTag,
  Payment,
  Reading,
  Session,
  SessionCrystal,
  SpreadLayout,
  SpreadPosition,
  SpreadSnapshotPosition,
  SpreadTemplate,
  SyncedTableName,
} from '../db/types';
import type { components } from './api.gen';

type Schemas = components['schemas'];

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

/** A row as the server sends it, minus the local-only and server-assigned columns. */
type Wire<Row> = Omit<Row, 'pending' | 'server_version'>;

// Responses carry exactly the local row, plus a non-null `server_version`.
type Pulled<Row, Record extends { server_version: number }> = Exact<
  Wire<Row>,
  Omit<Record, 'server_version'>
>;
// Requests accept the local row as it is pushed, and have no field the row lacks.
type Pushed<Row, Record> = [Wire<Row>] extends [Record]
  ? [keyof Record] extends [keyof Wire<Row>]
    ? true
    : false
  : false;

export type Checks = [
  Assert<Pulled<Client, Schemas['ClientRecord']>>,
  Assert<Pulled<Session, Schemas['SessionRecord']>>,
  Assert<Pulled<Payment, Schemas['PaymentRecord']>>,
  Assert<Pulled<Reading, Schemas['ReadingRecord']>>,
  Assert<Pulled<CardDraw, Schemas['CardDrawRecord']>>,
  Assert<Pulled<SpreadTemplate, Schemas['SpreadTemplateRecord']>>,
  Assert<Pulled<Crystal, Schemas['CrystalRecord']>>,
  Assert<Pulled<IntentionTag, Schemas['IntentionTagRecord']>>,
  Assert<Pulled<CardNote, Schemas['CardNoteRecord']>>,
  Assert<Pulled<SessionCrystal, Schemas['SessionCrystalRecord']>>,
  Assert<Pulled<Conflict, Schemas['ConflictRecord']>>,
  Assert<Pulled<Horoscope, Schemas['HoroscopeRecord']>>,

  Assert<Pushed<Client, Schemas['ClientRecordRequest']>>,
  Assert<Pushed<Session, Schemas['SessionRecordRequest']>>,
  Assert<Pushed<Payment, Schemas['PaymentRecordRequest']>>,
  Assert<Pushed<Reading, Schemas['ReadingRecordRequest']>>,
  Assert<Pushed<CardDraw, Schemas['CardDrawRecordRequest']>>,
  Assert<Pushed<SpreadTemplate, Schemas['SpreadTemplateRecordRequest']>>,
  Assert<Pushed<Crystal, Schemas['CrystalRecordRequest']>>,
  Assert<Pushed<IntentionTag, Schemas['IntentionTagRecordRequest']>>,
  Assert<Pushed<CardNote, Schemas['CardNoteRecordRequest']>>,
  Assert<Pushed<SessionCrystal, Schemas['SessionCrystalRecordRequest']>>,
  Assert<Pushed<Conflict, Schemas['ConflictRecordRequest']>>,

  // JSON columns.
  Assert<Exact<SpreadLayout, Schemas['SpreadLayout']>>,
  Assert<Exact<SpreadPosition, Schemas['SpreadPosition']>>,
  Assert<Exact<SpreadSnapshotPosition, Schemas['SpreadPosition']>>,
  Assert<Exact<Reading['spread_snapshot'], Schemas['SpreadSnapshot']>>,

  // Table names: every table is pulled, every table but `horoscope` can be pushed.
  Assert<Exact<SyncedTableName, Schemas['SyncedTableEnum']>>,
  Assert<Exact<SyncedTableName, Schemas['PulledChange']['table']>>,
  Assert<Exact<Exclude<SyncedTableName, 'horoscope'>, Schemas['PushChangeRequest']['table']>>,
];

describe('api types', () => {
  it('are checked by the type checker (npm run typecheck)', () => {
    expect(true).toBe(true);
  });
});
