import { getDeviceId, newId, nowIso, type ArcanaDB, type Clock, type Session } from '../../db';
import { sumByCurrency, type CurrencyTotals } from '../payments';
import {
  defaultSessionFields,
  pickSessionFields,
  sameSessionFields,
  type SessionFields,
} from './form';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

async function stamp(db: ArcanaDB, clock: Clock) {
  return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
}

export interface CreatedSession {
  session: Session;
  /** True when the client was archived and creating the session brought them back. */
  unarchived: boolean;
}

/**
 * Starts a session for the client with the defaults (now, in person, no price, colones). An
 * archived client is unarchived in the same transaction: they came back.
 */
export async function createSession(
  db: ArcanaDB,
  clientId: string,
  clock: Clock = nowIso,
): Promise<CreatedSession> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', [db.client, db.session], async () => {
    const client = await db.client.get(clientId);
    if (!client || client.deleted_at !== null) throw new Error(`client not found: ${clientId}`);

    const session: Session = {
      ...defaultSessionFields(stamped.updated_at),
      client_id: clientId,
      id: newId(),
      deleted_at: null,
      server_version: null,
      ...stamped,
    };
    await db.session.add(session);
    if (client.archived) await db.client.put({ ...client, archived: false, ...stamped });
    return { session, unarchived: client.archived };
  });
}

export interface SessionDeletionSummary {
  readings: number;
  payments: number;
  /** Total paid per currency (minor units); currencies are never summed together. */
  paidByCurrency: CurrencyTotals;
}

/** What deleting a session would remove, for the confirmation dialog. Tombstones aren't counted. */
export async function getSessionDeletionSummary(
  db: ArcanaDB,
  sessionId: string,
): Promise<SessionDeletionSummary> {
  const [readings, payments] = await Promise.all([
    db.reading.where('session_id').equals(sessionId).filter(live).count(),
    db.payment.where('session_id').equals(sessionId).filter(live).toArray(),
  ]);
  return { readings, payments: payments.length, paidByCurrency: sumByCurrency(payments) };
}

/** Tombstones the session and its payments, readings and card draws. Call inside a transaction. */
async function tombstoneSession(
  db: ArcanaDB,
  session: Session,
  tombstone: Awaited<ReturnType<typeof stamp>> & { deleted_at: string },
): Promise<void> {
  const payments = await db.payment.where('session_id').equals(session.id).filter(live).toArray();
  const readings = await db.reading.where('session_id').equals(session.id).filter(live).toArray();
  const draws = await db.card_draw
    .where('reading_id')
    .anyOf(readings.map((reading) => reading.id))
    .filter(live)
    .toArray();

  await db.session.put({ ...session, ...tombstone });
  await db.payment.bulkPut(payments.map((row) => ({ ...row, ...tombstone })));
  await db.reading.bulkPut(readings.map((row) => ({ ...row, ...tombstone })));
  await db.card_draw.bulkPut(draws.map((row) => ({ ...row, ...tombstone })));
}

/**
 * Soft-deletes the session and everything under it (payments, readings, card draws) in one
 * transaction, so the tombstones sync and nothing is left orphaned.
 */
export async function deleteSession(
  db: ArcanaDB,
  sessionId: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  const tombstone = { ...stamped, deleted_at: stamped.updated_at };
  await db.transaction('rw', [db.session, db.payment, db.reading, db.card_draw], async () => {
    const session = await db.session.get(sessionId);
    if (!session || session.deleted_at !== null) return;
    await tombstoneSession(db, session, tombstone);
  });
}

export interface DiscardOptions {
  /** The client was unarchived by creating this session; archive them again on discard. */
  rearchiveClient?: boolean;
  clock?: Clock;
}

/**
 * Silently discards a session she opened by mistake: tombstones it if its fields are still
 * exactly as created and it has no readings or payments. Returns whether it was discarded.
 */
export async function discardIfUntouched(
  db: ArcanaDB,
  sessionId: string,
  created: SessionFields,
  { rearchiveClient = false, clock = nowIso }: DiscardOptions = {},
): Promise<boolean> {
  const stamped = await stamp(db, clock);
  const tombstone = { ...stamped, deleted_at: stamped.updated_at };
  return db.transaction(
    'rw',
    [db.client, db.session, db.payment, db.reading, db.card_draw],
    async () => {
      const session = await db.session.get(sessionId);
      if (!session || session.deleted_at !== null) return false;
      if (!sameSessionFields(pickSessionFields(session), created)) return false;
      const { readings, payments } = await getSessionDeletionSummary(db, sessionId);
      if (readings > 0 || payments > 0) return false;

      await tombstoneSession(db, session, tombstone);
      if (rearchiveClient) {
        const client = await db.client.get(session.client_id);
        if (client && client.deleted_at === null && !client.archived) {
          await db.client.put({ ...client, archived: true, ...stamped });
        }
      }
      return true;
    },
  );
}
