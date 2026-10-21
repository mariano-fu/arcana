import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { db, repos, type Client, type IsoDate, type Payment, type Session } from '../../db';
import { todayLocal } from '../payments';

/**
 * Today's local calendar date, kept current while the app stays open: it rolls over at the
 * next local midnight and is rechecked whenever the app comes back to the foreground.
 */
export function useToday(): IsoDate {
  const [today, setToday] = useState(() => todayLocal());

  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => {
      setToday(todayLocal());
    }, midnight.getTime() - now.getTime());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setToday(todayLocal());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [today]);

  return today;
}

export interface HomeData {
  sessions: Session[];
  /** Live clients by id, archived included. */
  clients: Map<string, Client>;
  /** Live payments, for the recent sessions' status badges. */
  payments: Payment[];
}

/** Everything Inicio reads, live; undefined while loading. */
export function useHomeData(): HomeData | undefined {
  return useLiveQuery(async () => {
    const [sessions, clients, payments] = await Promise.all([
      repos.session.list(),
      repos.client.list(),
      db.payment.filter((row) => row.deleted_at === null).toArray(),
    ]);
    return {
      sessions,
      clients: new Map(clients.map((client) => [client.id, client])),
      payments,
    };
  });
}
