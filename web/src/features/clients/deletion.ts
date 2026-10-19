import { getDeviceId, nowIso, type ArcanaDB, type Clock } from '../../db';
import { sumByCurrency, type CurrencyTotals } from '../payments';

export interface DeletionSummary {
  sessions: number;
  payments: number;
  /** Total paid per currency (minor units); currencies are never summed together. */
  paidByCurrency: CurrencyTotals;
}

/** What deleting a client would remove, for the confirmation dialog. Tombstones aren't counted. */
export async function getDeletionSummary(db: ArcanaDB, clientId: string): Promise<DeletionSummary> {
  const [sessions, payments] = await Promise.all([
    db.session
      .where('client_id')
      .equals(clientId)
      .filter((row) => row.deleted_at === null)
      .count(),
    db.payment
      .where('client_id')
      .equals(clientId)
      .filter((row) => row.deleted_at === null)
      .toArray(),
  ]);
  return { sessions, payments: payments.length, paidByCurrency: sumByCurrency(payments) };
}

/**
 * Soft-deletes the client and everything under it (sessions, payments, readings, card draws)
 * in one transaction, so the tombstones sync and nothing is left orphaned.
 */
export async function deleteClient(
  db: ArcanaDB,
  clientId: string,
  clock: Clock = nowIso,
): Promise<void> {
  const deviceId = await getDeviceId(db);
  const now = clock();
  const tombstone = { updated_at: now, deleted_at: now, device_id: deviceId, pending: 1 as const };
  const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

  await db.transaction(
    'rw',
    [db.client, db.session, db.payment, db.reading, db.card_draw],
    async () => {
      const client = await db.client.get(clientId);
      if (!client || client.deleted_at !== null) return;

      const sessions = await db.session.where('client_id').equals(clientId).filter(live).toArray();
      const sessionIds = sessions.map((session) => session.id);
      const payments = await db.payment.where('client_id').equals(clientId).filter(live).toArray();
      const readings = await db.reading
        .where('session_id')
        .anyOf(sessionIds)
        .filter(live)
        .toArray();
      const draws = await db.card_draw
        .where('reading_id')
        .anyOf(readings.map((reading) => reading.id))
        .filter(live)
        .toArray();

      await db.client.put({ ...client, ...tombstone });
      await db.session.bulkPut(sessions.map((row) => ({ ...row, ...tombstone })));
      await db.payment.bulkPut(payments.map((row) => ({ ...row, ...tombstone })));
      await db.reading.bulkPut(readings.map((row) => ({ ...row, ...tombstone })));
      await db.card_draw.bulkPut(draws.map((row) => ({ ...row, ...tombstone })));
    },
  );
}
