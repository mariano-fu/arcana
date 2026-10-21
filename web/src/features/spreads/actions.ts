import { v5 as uuidv5 } from 'uuid';

import {
  getDeviceId,
  newId,
  nowIso,
  type ArcanaDB,
  type CardDraw,
  type Clock,
  type Reading,
} from '../../db';
import { snapshotFromTemplate } from './snapshot';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

async function stamp(db: ArcanaDB, clock: Clock) {
  return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
}

/** Fixed namespace for card draw ids. Never change it: synced rows depend on it. */
export const CARD_DRAW_ID_NAMESPACE = '49a52c1b-0b43-4b51-b27e-ddb87541748b';

/**
 * The id of the draw at a reading's position: a UUIDv5, the same on every device (the one
 * exception to UUIDv7 besides seed rows). Each position has at most one draw row, so two
 * devices filling the same position write the same row and last-write-wins settles it.
 */
export function drawId(readingId: string, positionIndex: number): string {
  return uuidv5(`card_draw:${readingId}:${String(positionIndex)}`, CARD_DRAW_ID_NAMESPACE);
}

/** Starts a reading in the session with a snapshot of the template as it is now. */
export async function createReading(
  db: ArcanaDB,
  sessionId: string,
  templateId: string,
  clock: Clock = nowIso,
): Promise<Reading> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', [db.session, db.spread_template, db.reading], async () => {
    const session = await db.session.get(sessionId);
    if (!session || !live(session)) throw new Error(`session not found: ${sessionId}`);
    const template = await db.spread_template.get(templateId);
    if (!template || !live(template)) throw new Error(`spread template not found: ${templateId}`);

    const reading: Reading = {
      session_id: sessionId,
      spread_template_id: templateId,
      spread_snapshot: snapshotFromTemplate(template),
      label: null,
      created_at: stamped.updated_at,
      id: newId(),
      deleted_at: null,
      server_version: null,
      ...stamped,
    };
    await db.reading.add(reading);
    return reading;
  });
}

async function liveReading(db: ArcanaDB, readingId: string): Promise<Reading> {
  const reading = await db.reading.get(readingId);
  if (!reading || !live(reading)) throw new Error(`reading not found: ${readingId}`);
  return reading;
}

/**
 * Puts a card at a position, replacing whatever was there. Placing a card where one was
 * removed brings the same row back, so the position's note survives.
 */
export async function placeCard(
  db: ArcanaDB,
  readingId: string,
  positionIndex: number,
  card: { card_id: string; reversed: boolean },
  clock: Clock = nowIso,
): Promise<CardDraw> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', [db.reading, db.card_draw], async () => {
    const reading = await liveReading(db, readingId);
    if (!reading.spread_snapshot.positions.some((p) => p.index === positionIndex)) {
      throw new Error(`reading ${readingId} has no position ${String(positionIndex)}`);
    }
    const id = drawId(readingId, positionIndex);
    const existing = await db.card_draw.get(id);
    const draw: CardDraw = {
      reading_id: readingId,
      position_index: positionIndex,
      note: existing?.note ?? '',
      server_version: existing?.server_version ?? null,
      ...card,
      id,
      deleted_at: null,
      ...stamped,
    };
    await db.card_draw.put(draw);
    return draw;
  });
}

/** Changes the live draw at a position; throws if the position is empty. */
async function updateDraw(
  db: ArcanaDB,
  readingId: string,
  positionIndex: number,
  patch: Partial<Pick<CardDraw, 'reversed' | 'note'>>,
  clock: Clock,
): Promise<void> {
  const stamped = await stamp(db, clock);
  await db.transaction('rw', db.card_draw, async () => {
    const draw = await db.card_draw.get(drawId(readingId, positionIndex));
    if (!draw || !live(draw)) {
      throw new Error(`no card at position ${String(positionIndex)} of ${readingId}`);
    }
    await db.card_draw.put({ ...draw, ...patch, ...stamped });
  });
}

export function setReversed(
  db: ArcanaDB,
  readingId: string,
  positionIndex: number,
  reversed: boolean,
  clock: Clock = nowIso,
): Promise<void> {
  return updateDraw(db, readingId, positionIndex, { reversed }, clock);
}

export function setDrawNote(
  db: ArcanaDB,
  readingId: string,
  positionIndex: number,
  note: string,
  clock: Clock = nowIso,
): Promise<void> {
  return updateDraw(db, readingId, positionIndex, { note }, clock);
}

/** "Quitar carta": tombstones the position's draw. Its note comes back if a card is placed again. */
export async function removeCard(
  db: ArcanaDB,
  readingId: string,
  positionIndex: number,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  await db.transaction('rw', db.card_draw, async () => {
    const draw = await db.card_draw.get(drawId(readingId, positionIndex));
    if (!draw || !live(draw)) return;
    await db.card_draw.put({ ...draw, ...stamped, deleted_at: stamped.updated_at });
  });
}

/** "Eliminar tirada": tombstones the reading and all its draws in one transaction. */
export async function deleteReading(
  db: ArcanaDB,
  readingId: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  const tombstone = { ...stamped, deleted_at: stamped.updated_at };
  await db.transaction('rw', [db.reading, db.card_draw], async () => {
    const reading = await db.reading.get(readingId);
    if (!reading || !live(reading)) return;
    const draws = await db.card_draw.where('reading_id').equals(readingId).filter(live).toArray();
    await db.reading.put({ ...reading, ...tombstone });
    await db.card_draw.bulkPut(draws.map((row) => ({ ...row, ...tombstone })));
  });
}

/**
 * Positions other than `positionIndex` that already hold `cardId`, for the "same card twice"
 * warning (she may override it when reading with more than one deck).
 */
export function positionsWithCard(
  draws: readonly CardDraw[],
  cardId: string,
  positionIndex: number,
): number[] {
  return draws
    .filter((d) => live(d) && d.card_id === cardId && d.position_index !== positionIndex)
    .map((d) => d.position_index)
    .sort((a, b) => a - b);
}
