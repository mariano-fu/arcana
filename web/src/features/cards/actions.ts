import { v5 as uuidv5 } from 'uuid';

import { getDeviceId, nowIso, type ArcanaDB, type CardNote, type Clock } from '../../db';

/** Fixed namespace for card note ids. Never change it: synced rows depend on it. */
export const CARD_NOTE_ID_NAMESPACE = 'd178deb6-deb4-4ae7-860a-c49fa8d31c28';

/**
 * The id of her note on a card: a UUIDv5 of the card key, the same on every device. Each card
 * has at most one note row, so two devices writing a note on the same card offline write the
 * same row and last-write-wins (plus the conflict log) settles it.
 */
export function cardNoteId(cardId: string): string {
  return uuidv5(`card_note:${cardId}`, CARD_NOTE_ID_NAMESPACE);
}

/**
 * Saves her note on a card. A blank note tombstones the row; writing again brings the same
 * row back.
 */
export async function saveCardNote(
  db: ArcanaDB,
  cardId: string,
  note: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
  const id = cardNoteId(cardId);
  await db.transaction('rw', db.card_note, async () => {
    const existing = await db.card_note.get(id);
    if (note.trim() === '') {
      if (existing && existing.deleted_at === null) {
        await db.card_note.put({ ...existing, ...stamped, deleted_at: stamped.updated_at });
      }
      return;
    }
    const row: CardNote = {
      id,
      card_id: cardId,
      note,
      deleted_at: null,
      server_version: existing?.server_version ?? null,
      ...stamped,
    };
    await db.card_note.put(row);
  });
}
