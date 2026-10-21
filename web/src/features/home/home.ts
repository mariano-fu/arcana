// Inicio: which follow-ups, balances and recent sessions show, and in what order.
// The rules marked "Provisional (T1.12 Dn)" are recommendations Mariano still has to confirm
// (specs/plan.md, "Inicio").

import type { Client, IsoDate, Session } from '../../db';
import { sumByCurrency, type CurrencyTotals, type PendingBalance } from '../payments';
import { newestFirst } from '../sessions/timeline';

/** Provisional (T1.12 D1): overdue follow-ups show for this many days, then drop off. */
export const OVERDUE_DAYS = 30;
/** Provisional (T1.12 D4): how far ahead an upcoming follow-up shows. */
export const UPCOMING_DAYS = 30;
/** Provisional (T1.12 D3): items per section. */
export const FOLLOW_UP_LIMIT = 10;
export const BALANCE_LIMIT = 5;
export const RECENT_LIMIT = 5;

/** Calendar days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const utc = (date: IsoDate) => {
    const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export interface FollowUp {
  session: Session;
  client: Client;
  /** Days from today to the follow-up date: negative overdue, 0 today, 1 tomorrow. */
  days: number;
}

/**
 * Follow-ups to show on `today` (the device's local date, Provisional T1.12 D5): live sessions
 * with a follow-up date from OVERDUE_DAYS ago to UPCOMING_DAYS ahead, overdue first (oldest
 * first), then today, then upcoming (soonest first); ties by client name, then session id.
 * `clients` holds the live clients; a session whose client is missing is left out.
 */
export function followUps(
  sessions: readonly Session[],
  clients: ReadonlyMap<string, Client>,
  today: IsoDate,
): FollowUp[] {
  const live = sessions.filter((session) => session.deleted_at === null);
  const result: FollowUp[] = [];
  for (const session of live) {
    if (session.follow_up_date === null) continue;
    const client = clients.get(session.client_id);
    if (!client) continue;
    // Provisional (T1.12 D2): archived clients' follow-ups are hidden.
    if (client.archived) continue;
    const days = daysBetween(today, session.follow_up_date);
    if (days < -OVERDUE_DAYS || days > UPCOMING_DAYS) continue;
    // Provisional (T1.12 D1): a later session with the same client handles the follow-up.
    const handled = live.some(
      (other) => other.client_id === session.client_id && other.started_at > session.started_at,
    );
    if (handled) continue;
    result.push({ session, client, days });
  }
  return result.sort(
    (a, b) =>
      a.days - b.days ||
      a.client.name.localeCompare(b.client.name, 'es', { sensitivity: 'base' }) ||
      a.session.id.localeCompare(b.session.id),
  );
}

export interface RecentSession {
  session: Session;
  client: Client;
}

/** The newest live sessions of live clients (archived included), newest first. */
export function recentSessions(
  sessions: readonly Session[],
  clients: ReadonlyMap<string, Client>,
  limit = RECENT_LIMIT,
): RecentSession[] {
  const result: RecentSession[] = [];
  for (const session of newestFirst(sessions.filter((s) => s.deleted_at === null))) {
    const client = clients.get(session.client_id);
    if (client) result.push({ session, client });
    if (result.length === limit) break;
  }
  return result;
}

/** What is owed per currency; currencies are never added together. */
export function balanceTotals(balances: Iterable<PendingBalance>): CurrencyTotals {
  return sumByCurrency(
    Array.from(balances, ({ balance_minor, currency }) => ({
      amount_minor: balance_minor,
      currency,
    })),
  );
}
