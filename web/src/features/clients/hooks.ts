import { useLiveQuery } from 'dexie-react-hooks';

import { db, repos, type Client } from '../../db';
import { getDeletionSummary, type DeletionSummary } from './deletion';
import { withLastVisit, type ClientListItem } from './list';

/** Live clients with their last visit; undefined while loading. */
export function useClientList(): ClientListItem[] | undefined {
  return useLiveQuery(async () => {
    const [clients, sessions] = await Promise.all([repos.client.list(), repos.session.list()]);
    return withLastVisit(clients, sessions);
  });
}

/** The client, null if it doesn't exist (or was deleted), undefined while loading. */
export function useClient(id: string | undefined): Client | null | undefined {
  return useLiveQuery(
    async () => (id === undefined ? null : ((await repos.client.get(id)) ?? null)),
    [id],
  );
}

export function useDeletionSummary(id: string): DeletionSummary | undefined {
  return useLiveQuery(() => getDeletionSummary(db, id), [id]);
}
