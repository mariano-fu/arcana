import { useLiveQuery } from 'dexie-react-hooks';

import { db, type Payment } from '../../db';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

/** Newest payment first; same day falls back to creation order, newest first (UUIDv7 ids). */
function newestFirst(payments: Payment[]): Payment[] {
  return payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.id.localeCompare(a.id));
}

/** The session's live payments, newest first; undefined while loading. */
export function useSessionPayments(sessionId: string): Payment[] | undefined {
  return useLiveQuery(
    async () =>
      newestFirst(await db.payment.where('session_id').equals(sessionId).filter(live).toArray()),
    [sessionId],
  );
}

/** The client's live payments, unordered; undefined while loading. */
export function useClientPayments(clientId: string): Payment[] | undefined {
  return useLiveQuery(
    () => db.payment.where('client_id').equals(clientId).filter(live).toArray(),
    [clientId],
  );
}
