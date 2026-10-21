import { db } from '../../db';
import { clearDb } from '../clients/test-utils';
import { CARD_NOTE_ID_NAMESPACE, cardNoteId, saveCardNote } from './actions';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(async () => {
  await clearDb();
});

describe('cardNoteId', () => {
  it('is a UUIDv5 that depends only on the card', () => {
    expect(CARD_NOTE_ID_NAMESPACE).toBe('d178deb6-deb4-4ae7-860a-c49fa8d31c28');
    expect(cardNoteId('major-01')).toMatch(UUID_V5);
    expect(cardNoteId('major-01')).toBe(cardNoteId('major-01'));
    expect(cardNoteId('major-01')).not.toBe(cardNoteId('cups-01'));
  });
});

describe('saveCardNote', () => {
  it('keeps one row per card, stamped for sync', async () => {
    await saveCardNote(db, 'major-01', 'Primera');
    await saveCardNote(db, 'major-01', 'Segunda');

    const rows = await db.card_note.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: cardNoteId('major-01'),
      card_id: 'major-01',
      note: 'Segunda',
      pending: 1,
      deleted_at: null,
    });
  });

  it('tombstones a blank note and revives the same row on the next write', async () => {
    await saveCardNote(db, 'major-01', 'Algo');
    await db.card_note.update(cardNoteId('major-01'), { server_version: 4 });

    await saveCardNote(db, 'major-01', '  ');
    const cleared = await db.card_note.get(cardNoteId('major-01'));
    expect(cleared?.deleted_at).not.toBeNull();
    expect(cleared?.deleted_at).toBe(cleared?.updated_at);
    expect(cleared?.pending).toBe(1);

    await saveCardNote(db, 'major-01', 'Otra vez');
    expect(await db.card_note.get(cardNoteId('major-01'))).toMatchObject({
      note: 'Otra vez',
      deleted_at: null,
      server_version: 4,
    });
    expect(await db.card_note.count()).toBe(1);
  });

  it('writes nothing for a blank note on a card without one', async () => {
    await saveCardNote(db, 'major-01', '');
    expect(await db.card_note.count()).toBe(0);
  });
});
