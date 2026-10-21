import { ArcanaDB } from './db';
import {
  createReadonlyRepository,
  createRepository,
  type Clock,
  type ReadonlyRepository,
  type Repository,
} from './repository';
import type { Horoscope, SyncedTableName, SyncedTables } from './types';

export { ArcanaDB } from './db';
export { forgetDeviceId, getDeviceId } from './device';
export { newId, nowIso } from './ids';
export { HardDeleteError, nextUpdatedAt, writeVerbatim } from './monotonic';
export * from './repository';
export type * from './types';

type WritableTableName = Exclude<SyncedTableName, 'horoscope'>;

export type Repositories = { [K in WritableTableName]: Repository<SyncedTables[K]> } & {
  horoscope: ReadonlyRepository<Horoscope>;
};

export function createRepositories(db: ArcanaDB, clock?: Clock): Repositories {
  return {
    client: createRepository(db, db.client, clock),
    session: createRepository(db, db.session, clock),
    payment: createRepository(db, db.payment, clock),
    reading: createRepository(db, db.reading, clock),
    card_draw: createRepository(db, db.card_draw, clock),
    spread_template: createRepository(db, db.spread_template, clock),
    crystal: createRepository(db, db.crystal, clock),
    intention_tag: createRepository(db, db.intention_tag, clock),
    card_note: createRepository(db, db.card_note, clock),
    conflict: createRepository(db, db.conflict, clock),
    // Server-owned: only the sync engine writes it.
    horoscope: createReadonlyRepository(db.horoscope),
  };
}

export const db = new ArcanaDB();
export const repos = createRepositories(db);
