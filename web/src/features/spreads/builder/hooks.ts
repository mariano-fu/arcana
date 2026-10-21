import { useLiveQuery } from 'dexie-react-hooks';

import { db, type SpreadTemplate } from '../../../db';
import { spreadNames } from './actions';

/** The live template, null if it doesn't exist (or was deleted), undefined while loading. */
export function useSpreadTemplate(id: string | undefined): SpreadTemplate | null | undefined {
  return useLiveQuery(async () => {
    if (id === undefined) return null;
    const template = await db.spread_template.get(id);
    return template && template.deleted_at === null ? template : null;
  }, [id]);
}

/** Names of every other live spread (seed and custom), for the duplicate-name check. */
export function useOtherSpreadNames(exceptId: string | undefined): string[] | undefined {
  return useLiveQuery(() => spreadNames(db, exceptId), [exceptId]);
}
