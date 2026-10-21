import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../../db';
import { cardNoteId } from './actions';

/** Her personal note on a card as she wrote it ('' when she has none); undefined while loading. */
export function useCardNote(cardId: string): string | undefined {
  return useLiveQuery(async () => {
    const row = await db.card_note.get(cardNoteId(cardId));
    return row && row.deleted_at === null ? row.note : '';
  }, [cardId]);
}

/** Keys of the cards she has a note on; undefined while loading. */
export function useNotedCards(): Set<string> | undefined {
  return useLiveQuery(async () => {
    const rows = await db.card_note
      .filter((row) => row.deleted_at === null && row.note.trim() !== '')
      .toArray();
    return new Set(rows.map((row) => row.card_id));
  });
}
