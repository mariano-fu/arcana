import { ArcanaDB, db, getDeviceId, repos, type CardDraw, type Session } from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { spreadsSeed } from '../../seed/spreads';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import {
  createReading,
  deleteReading,
  drawId,
  placeCard,
  positionsWithCard,
  removeCard,
  setDrawNote,
  setReversed,
} from './actions';

/** A clock that advances one second per call, so every write gets a distinct timestamp. */
function fakeClock(start = '2026-10-20T15:00:00.000Z') {
  let t = Date.parse(start);
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CELTIC_CROSS = seedId('spread_template', 'celtic-cross');

let clock: () => string;
let session: Session;

beforeEach(async () => {
  await clearDb();
  clock = fakeClock();
  await loadSeed(db);
  const client = await repos.client.create(newClient());
  session = await repos.session.create(newSession(client.id));
});

describe('createReading', () => {
  it('snapshots the spread name and every position with its layout', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    const seed = spreadsSeed.spreads.find((s) => s.key === 'celtic-cross');

    expect(reading).toMatchObject({
      session_id: session.id,
      spread_template_id: CELTIC_CROSS,
      label: null,
      created_at: reading.updated_at,
      pending: 1,
      deleted_at: null,
      server_version: null,
    });
    expect(reading.spread_snapshot).toEqual({ name: seed?.name, positions: seed?.positions });
    expect(reading.spread_snapshot.positions[1]?.layout).toEqual({ col: 1, row: 1, rotated: true });
    expect(await repos.reading.get(reading.id)).toEqual(reading);
  });

  it('keeps the stored snapshot when the template row is edited and then deleted', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    const before = structuredClone(reading.spread_snapshot);

    const template = await repos.spread_template.get(CELTIC_CROSS);
    if (!template) throw new Error('seed spread missing');
    await repos.spread_template.update(CELTIC_CROSS, {
      name: 'Cruz editada',
      positions: template.positions.map((p) => ({
        ...p,
        name: `${p.name} (editada)`,
        meaning: 'Otro significado',
        layout: p.layout && { ...p.layout, col: p.layout.col + 1, rotated: false },
      })),
    });
    await repos.spread_template.remove(CELTIC_CROSS);

    expect((await db.spread_template.get(CELTIC_CROSS))?.deleted_at).not.toBeNull();
    expect((await repos.reading.get(reading.id))?.spread_snapshot).toEqual(before);
  });

  it('rejects a missing session or template', async () => {
    await expect(createReading(db, 'nope', CELTIC_CROSS, clock)).rejects.toThrow();
    await expect(createReading(db, session.id, 'nope', clock)).rejects.toThrow();
    await repos.spread_template.remove(CELTIC_CROSS);
    await expect(createReading(db, session.id, CELTIC_CROSS, clock)).rejects.toThrow();
  });
});

describe('card draws', () => {
  it('gives each position a deterministic UUIDv5 id', () => {
    expect(drawId('r1', 3)).toMatch(UUID_V5);
    expect(drawId('r1', 3)).toBe(drawId('r1', 3));
    expect(drawId('r1', 3)).not.toBe(drawId('r1', 4));
    expect(drawId('r1', 3)).not.toBe(drawId('r2', 3));
  });

  it('gives two devices filling the same position the same row id', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    // The other device received the reading through sync.
    const other = new ArcanaDB(`other-${crypto.randomUUID()}`);
    await other.reading.put(reading);

    const here = await placeCard(
      db,
      reading.id,
      1,
      { card_id: 'major-01', reversed: false },
      clock,
    );
    const there = await placeCard(other, reading.id, 1, { card_id: 'cups-02', reversed: true });

    expect(there.id).toBe(here.id);
    expect(there.device_id).toBe(await getDeviceId(other));
    expect(there.device_id).not.toBe(here.device_id);
    other.close();
  });

  it('replaces the card at a position instead of adding a row', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false }, clock);
    const second = await placeCard(
      db,
      reading.id,
      1,
      { card_id: 'swords-03', reversed: true },
      clock,
    );

    const rows = await db.card_draw.where('reading_id').equals(reading.id).toArray();
    expect(rows).toEqual([second]);
    expect(second).toMatchObject<Partial<CardDraw>>({
      id: drawId(reading.id, 1),
      position_index: 1,
      card_id: 'swords-03',
      reversed: true,
      pending: 1,
    });
  });

  it('rejects a position the snapshot does not have', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    await expect(
      placeCard(db, reading.id, 11, { card_id: 'major-01', reversed: false }, clock),
    ).rejects.toThrow();
  });

  it('turns and annotates a placed card', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    await placeCard(db, reading.id, 2, { card_id: 'major-01', reversed: false }, clock);

    await setReversed(db, reading.id, 2, true, clock);
    await setDrawNote(db, reading.id, 2, 'Bloqueo en el trabajo', clock);

    expect(await db.card_draw.get(drawId(reading.id, 2))).toMatchObject({
      reversed: true,
      note: 'Bloqueo en el trabajo',
    });
    await expect(setReversed(db, reading.id, 3, true, clock)).rejects.toThrow();
  });

  it('keeps the position note when a removed card is placed again', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false }, clock);
    await setDrawNote(db, reading.id, 1, 'Nota de la posición', clock);

    await removeCard(db, reading.id, 1, clock);
    const removed = await db.card_draw.get(drawId(reading.id, 1));
    expect(removed?.deleted_at).toBe(removed?.updated_at);
    expect(await repos.card_draw.get(drawId(reading.id, 1))).toBeUndefined();

    const again = await placeCard(
      db,
      reading.id,
      1,
      { card_id: 'cups-05', reversed: false },
      clock,
    );
    expect(again).toMatchObject({
      id: removed?.id,
      deleted_at: null,
      card_id: 'cups-05',
      note: 'Nota de la posición',
    });
    expect(again.updated_at > (removed?.updated_at ?? '')).toBe(true);
  });

  it('deletes a reading with all its draws in one go', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS, clock);
    const keep = await createReading(db, session.id, CELTIC_CROSS, clock);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false }, clock);
    await placeCard(db, reading.id, 2, { card_id: 'major-02', reversed: false }, clock);
    await placeCard(db, keep.id, 1, { card_id: 'major-01', reversed: false }, clock);

    await deleteReading(db, reading.id, clock);

    const stored = await db.reading.get(reading.id);
    expect(stored).toMatchObject({ pending: 1 });
    expect(stored?.deleted_at).toBe(stored?.updated_at);
    const draws = await db.card_draw.where('reading_id').equals(reading.id).toArray();
    expect(draws).toHaveLength(2);
    expect(draws.every((d) => d.deleted_at === stored?.deleted_at && d.pending === 1)).toBe(true);
    expect(await repos.card_draw.get(drawId(keep.id, 1))).toBeDefined();
    expect(await repos.reading.get(keep.id)).toBeDefined();
  });
});

describe('positionsWithCard', () => {
  const draw = (position_index: number, card_id: string, deleted_at: string | null = null) =>
    ({ position_index, card_id, deleted_at }) as CardDraw;

  it('lists other live positions holding the card', () => {
    const draws = [
      draw(1, 'major-01'),
      draw(3, 'major-01'),
      draw(2, 'cups-01'),
      draw(4, 'major-01', 'x'),
    ];
    expect(positionsWithCard(draws, 'major-01', 5)).toEqual([1, 3]);
    expect(positionsWithCard(draws, 'major-01', 1)).toEqual([3]);
    expect(positionsWithCard(draws, 'wands-01', 1)).toEqual([]);
  });
});
