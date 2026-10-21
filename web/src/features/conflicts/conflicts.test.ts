import { ArcanaDB, createRepositories, type Repositories } from '../../db';
import { newClient, newPayment, newSession } from '../clients/test-utils';
import { combinedText } from './actions';
import { FREE_TEXT_FIELDS, isFreeText, linkTo, loadReview } from './conflicts';
import { findOrphanSessions } from './orphans';
import { conflictRow } from './test-utils';

let db: ArcanaDB;
let repos: Repositories;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  repos = createRepositories(db);
});

afterEach(async () => {
  await db.delete();
});

describe('isFreeText', () => {
  it('matches the fields the server records conflicts for', () => {
    expect(FREE_TEXT_FIELDS).toEqual({
      client: ['notes'],
      session: ['notes', 'follow_up_note'],
      payment: ['note'],
      card_draw: ['note'],
      card_note: ['note'],
    });
    expect(isFreeText('session', 'follow_up_note')).toBe(true);
    expect(isFreeText('payment', 'amount_minor')).toBe(false);
    expect(isFreeText('client', 'birth_date')).toBe(false);
  });
});

describe('loadReview', () => {
  it('groups open conflicts per field, newest first, with the current value', async () => {
    const client = await repos.client.create(newClient({ name: 'Ana', notes: 'Actual' }));
    const older = conflictRow('client', client.id, 'notes', {
      losing_value: 'Vieja',
      created_at: '2026-10-19T10:00:00.000Z',
    });
    const newer = conflictRow('client', client.id, 'notes', {
      losing_value: 'Nueva',
      created_at: '2026-10-20T10:00:00.000Z',
    });
    const resolved = conflictRow('client', client.id, 'notes', { resolved: true });
    const tombstoned = conflictRow('client', client.id, 'notes', {
      deleted_at: '2026-10-20T11:00:00.000Z',
    });
    await db.conflict.bulkPut([older, newer, resolved, tombstoned]);

    const review = await loadReview(db);

    expect(review.groups).toHaveLength(1);
    const [group] = review.groups;
    expect(group?.conflicts.map((c) => c.losing_value)).toEqual(['Nueva', 'Vieja']);
    expect(group).toMatchObject({
      state: 'live',
      current: 'Actual',
      freeText: true,
      context: { kind: 'client', clientId: client.id, clientName: 'Ana' },
    });
    expect(review.count).toBe(1);
  });

  it('says where each table’s text lives', async () => {
    const client = await repos.client.create(newClient({ name: 'Ana' }));
    const session = await repos.session.create(newSession(client.id));
    const payment = await repos.payment.create(newPayment(session));
    const reading = await repos.reading.create({
      session_id: session.id,
      spread_template_id: 'template',
      spread_snapshot: { name: '1 carta', positions: [] },
      label: null,
      created_at: session.started_at,
    });
    const draw = await repos.card_draw.create({
      reading_id: reading.id,
      position_index: 1,
      card_id: 'major-00',
      reversed: false,
      note: '',
    });
    const note = await repos.card_note.create({ card_id: 'major-01', note: '' });
    await db.conflict.bulkPut([
      conflictRow('session', session.id, 'follow_up_note'),
      conflictRow('payment', payment.id, 'note'),
      conflictRow('card_draw', draw.id, 'note'),
      conflictRow('card_note', note.id, 'note'),
    ]);

    const contexts = Object.fromEntries(
      (await loadReview(db)).groups.map((group) => [group.table, group.context]),
    );

    expect(contexts.session).toEqual({
      kind: 'session',
      sessionId: session.id,
      clientName: 'Ana',
      startedAt: session.started_at,
    });
    expect(contexts.payment).toEqual({
      kind: 'payment',
      clientId: client.id,
      clientName: 'Ana',
      paidAt: payment.paid_at,
    });
    expect(contexts.card_draw).toEqual({
      kind: 'card_draw',
      sessionId: session.id,
      cardId: 'major-00',
    });
    expect(contexts.card_note).toEqual({ kind: 'card_note', cardId: 'major-01' });
    expect(linkTo(contexts.card_draw ?? { kind: 'other' })).toBe(`/sessions/${session.id}`);
    expect(linkTo(contexts.card_note ?? { kind: 'other' })).toBe('/cards/major-01');
  });

  it('marks a deleted row deleted and a row not synced here yet missing (not counted)', async () => {
    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);
    await db.conflict.bulkPut([
      conflictRow('client', client.id, 'notes'),
      conflictRow('client', crypto.randomUUID(), 'notes'),
    ]);

    const review = await loadReview(db);

    expect(review.groups.map((group) => [group.state, group.current]).sort()).toEqual([
      ['deleted', null],
      ['missing', null],
    ]);
    expect(review.count).toBe(1);
  });

  it('flags a non-free-text field (keep the current value only)', async () => {
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id, { price_minor: 2500000 }));
    await db.conflict.put(conflictRow('session', session.id, 'price_minor'));

    const [group] = (await loadReview(db)).groups;

    expect(group).toMatchObject({ freeText: false, current: '2500000' });
  });

  it('counts sessions of a deleted ficha', async () => {
    const client = await repos.client.create(newClient({ name: 'Eliminada' }));
    const session = await repos.session.create(newSession(client.id));
    await repos.payment.create(newPayment(session));
    // Deleted on another device; this session arrived later from a third one.
    await db.client.put({ ...client, deleted_at: '2026-10-20T00:00:00.000Z', pending: 0 });

    const review = await loadReview(db);

    expect(review.orphans).toEqual([expect.objectContaining({ readings: 0, payments: 1 })]);
    expect(review.orphans[0]?.session.id).toBe(session.id);
    expect(review.count).toBe(1);
  });
});

describe('findOrphanSessions', () => {
  it('ignores live clients, deleted sessions and clients not synced here yet', async () => {
    const liveClient = await repos.client.create(newClient());
    await repos.session.create(newSession(liveClient.id));
    const gone = await repos.client.create(newClient());
    const deletedSession = await repos.session.create(newSession(gone.id));
    await repos.session.remove(deletedSession.id);
    await repos.client.remove(gone.id);
    await repos.session.create(newSession(crypto.randomUUID()));

    expect(await findOrphanSessions(db)).toEqual([]);
  });
});

describe('combinedText', () => {
  it('puts the current text first, then the others, a blank line apart, skipping empties', () => {
    expect(combinedText('Actual', ['Otra', null, '  ', 'Tercera'])).toBe(
      'Actual\n\nOtra\n\nTercera',
    );
    expect(combinedText('', ['Otra'])).toBe('Otra');
  });
});
