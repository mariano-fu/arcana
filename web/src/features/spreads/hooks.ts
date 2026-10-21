import { useLiveQuery } from 'dexie-react-hooks';

import { db, type CardDraw, type Reading, type SpreadTemplate } from '../../db';
import { spreadsSeed } from '../../seed/spreads';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

export interface ReadingSummary {
  reading: Reading;
  /** How many positions hold a card. */
  placed: number;
}

/** The session's live readings, oldest first, with how many cards each has; undefined while loading. */
export function useSessionReadings(sessionId: string): ReadingSummary[] | undefined {
  return useLiveQuery(async () => {
    const readings = await db.reading.where('session_id').equals(sessionId).filter(live).toArray();
    readings.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const draws = await db.card_draw
      .where('reading_id')
      .anyOf(readings.map((reading) => reading.id))
      .filter(live)
      .toArray();
    return readings.map((reading) => ({
      reading,
      placed: draws.filter((draw) => draw.reading_id === reading.id).length,
    }));
  }, [sessionId]);
}

/** The reading, null if it doesn't exist (or was deleted), undefined while loading. */
export function useReading(id: string | undefined): Reading | null | undefined {
  return useLiveQuery(async () => {
    if (id === undefined) return null;
    const reading = await db.reading.get(id);
    return reading && live(reading) ? reading : null;
  }, [id]);
}

/** The reading's live draws; undefined while loading. */
export function useReadingDraws(readingId: string): CardDraw[] | undefined {
  return useLiveQuery(
    () => db.card_draw.where('reading_id').equals(readingId).filter(live).toArray(),
    [readingId],
  );
}

const seedOrder = new Map(spreadsSeed.spreads.map((spread, i) => [spread.key, i]));

/** Seed spreads first, in seed order; then her custom spreads by name. */
export function sortTemplates(templates: SpreadTemplate[]): SpreadTemplate[] {
  const rank = (t: SpreadTemplate) =>
    t.seed_key === null ? Infinity : (seedOrder.get(t.seed_key) ?? spreadsSeed.spreads.length);
  return [...templates].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );
}

/** Live spread templates to choose from; undefined while loading. */
export function useSpreadTemplates(): SpreadTemplate[] | undefined {
  return useLiveQuery(async () => sortTemplates(await db.spread_template.filter(live).toArray()));
}

/** Her personal note on a card (empty string when she has none); undefined while loading. */
export function useCardNote(cardId: string): string | undefined {
  return useLiveQuery(async () => {
    const notes = await db.card_note.where('card_id').equals(cardId).filter(live).toArray();
    return notes.map((row) => row.note.trim()).find((note) => note !== '') ?? '';
  }, [cardId]);
}
