import { useLiveQuery } from 'dexie-react-hooks';

import { db, repos, type Session } from '../../db';
import { getSessionDeletionSummary, type SessionDeletionSummary } from './actions';
import { newestFirst } from './timeline';

/** The session, null if it doesn't exist (or was deleted), undefined while loading. */
export function useSession(id: string | undefined): Session | null | undefined {
  return useLiveQuery(
    async () => (id === undefined ? null : ((await repos.session.get(id)) ?? null)),
    [id],
  );
}

/** The client's live sessions, newest first; undefined while loading. */
export function useClientSessions(clientId: string): Session[] | undefined {
  return useLiveQuery(async () => {
    const sessions = await db.session
      .where('client_id')
      .equals(clientId)
      .filter((row) => row.deleted_at === null)
      .toArray();
    return newestFirst(sessions);
  }, [clientId]);
}

export function useSessionDeletionSummary(id: string): SessionDeletionSummary | undefined {
  return useLiveQuery(() => getSessionDeletionSummary(db, id), [id]);
}
