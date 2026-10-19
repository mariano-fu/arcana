import { useLiveQuery } from 'dexie-react-hooks';

import { db, repos, type Client, type Payment } from '../../db';
import {
  monthRange,
  newestFirst,
  pendingBalances,
  type Month,
  type PendingBalance,
} from './report';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

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

/** Live payments dated in the month, newest first; undefined while loading. */
export function useMonthPayments(month: Month): Payment[] | undefined {
  const result = useLiveQuery(async () => {
    const [first, last] = monthRange(month);
    const payments = await db.payment
      .where('paid_at')
      .between(first, last, true, true)
      .filter(live)
      .toArray();
    return { month, payments: newestFirst(payments) };
  }, [month]);
  // useLiveQuery keeps returning the previous month's rows until the new query resolves.
  return result?.month === month ? result.payments : undefined;
}

/** Every session still owed something, oldest first; undefined while loading. */
export function usePendingBalances(): PendingBalance[] | undefined {
  return useLiveQuery(async () => {
    // Only priced sessions can owe anything, so only their payments are loaded.
    const sessions = (await repos.session.list()).filter((s) => (s.price_minor ?? 0) > 0);
    const payments = await db.payment
      .where('session_id')
      .anyOf(sessions.map((s) => s.id))
      .filter(live)
      .toArray();
    return pendingBalances(sessions, payments);
  });
}

/** Live clients by id, archived ones included; undefined while loading. */
export function useClientsById(): Map<string, Client> | undefined {
  return useLiveQuery(async () => {
    const clients = await repos.client.list();
    return new Map(clients.map((client) => [client.id, client]));
  });
}
