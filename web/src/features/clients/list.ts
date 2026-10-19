import type { Client, IsoDateTime, Session } from '../../db';

export interface ClientListItem {
  client: Client;
  /** `started_at` of the client's latest session; null when there are none. */
  lastVisit: IsoDateTime | null;
}

/** Lowercase, accents removed, so "Martínez" matches "martinez". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Matches the name or the Instagram handle, ignoring case, accents and a leading `@`. */
export function matchesQuery(client: Client, query: string): boolean {
  const q = normalize(query).replace(/^@+/, '');
  if (q === '') return true;
  if (normalize(client.name).includes(q)) return true;
  return client.instagram !== null && normalize(client.instagram).includes(q);
}

/** Pairs each client with the start of their latest live session. */
export function withLastVisit(clients: Client[], sessions: Session[]): ClientListItem[] {
  const latest = new Map<string, IsoDateTime>();
  for (const session of sessions) {
    if (session.deleted_at !== null) continue;
    const current = latest.get(session.client_id);
    if (current === undefined || session.started_at > current) {
      latest.set(session.client_id, session.started_at);
    }
  }
  return clients.map((client) => ({ client, lastVisit: latest.get(client.id) ?? null }));
}

/** Last visit, or when the client was added if they have no sessions yet. */
export function lastActivity(item: ClientListItem): IsoDateTime {
  return item.lastVisit ?? item.client.created_at;
}

/** Most recent activity first; ties by name. Timestamps are ISO UTC, so they compare as strings. */
export function sortByLastActivity(items: ClientListItem[]): ClientListItem[] {
  return [...items].sort((a, b) => {
    const byActivity = lastActivity(b).localeCompare(lastActivity(a));
    return byActivity !== 0 ? byActivity : a.client.name.localeCompare(b.client.name, 'es');
  });
}
