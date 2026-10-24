import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../../db';
import { loadReview, type Review } from './conflicts';

/** Conflicts and orphaned sessions; undefined while loading. Updates after every sync. */
export function useReview(): Review | undefined {
  return useLiveQuery(() => loadReview(db));
}

/** How many items need her (the Inicio card and the tab badge); 0 while loading. */
export function useReviewCount(): number {
  return useReview()?.count ?? 0;
}
