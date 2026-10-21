import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos, type Session } from '../../db';
import es from '../../i18n/locales/es.json';
import { cardsSeed } from '../../seed/cards';
import { loadSeed, seedId } from '../../seed/loader';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { createReading, drawId, placeCard, removeCard } from './actions';

const CELTIC_CROSS = seedId('spread_template', 'celtic-cross');

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function seedCard(key: string) {
  const card = cardsSeed.cards.find((c) => c.key === key);
  if (!card) throw new Error(`${key} missing`);
  return card;
}

/** The position row in the list below the grid, by its "1 · Situación actual" label. */
function positionButton(label: string) {
  return screen.getByRole('button', { name: new RegExp(`^${label}:`) });
}

let session: Session;

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
  const client = await repos.client.create(newClient({ name: 'Ana Prueba' }));
  session = await repos.session.create(newSession(client.id));
});

/** Opens a new Cruz Celta reading on the session page and returns its id. */
async function startCelticCross(user: ReturnType<typeof userEvent.setup>) {
  const router = renderAt(`/sessions/${session.id}`);
  await user.click(await screen.findByRole('link', { name: es.sessions.readings.new }));
  await user.click(await screen.findByRole('button', { name: /^Cruz Celta/ }));
  await screen.findByRole('heading', { level: 1, name: 'Cruz Celta' });
  const [reading] = await repos.reading.list();
  if (!reading) throw new Error('reading not created');
  expect(router.state.location.pathname).toBe(`/sessions/${session.id}/readings/${reading.id}`);
  return { router, reading };
}

describe('readings', () => {
  it('creates a reading from the session page and lists all its positions', async () => {
    const user = userEvent.setup();
    await startCelticCross(user);

    const list = screen.getByRole('list', { name: es.spreads.reading.positions });
    expect(within(list).getAllByRole('button')).toHaveLength(10);
    // The crossed card under the Desafío is reachable from the list.
    expect(positionButton('1 · Situación actual')).toHaveAccessibleName(
      '1 · Situación actual: sin carta',
    );
    expect(positionButton('2 · Desafío')).toBeVisible();
    expect(screen.getByTestId('spread-grid').querySelectorAll('[data-position]')).toHaveLength(10);
  });

  it('picks a card by search in 2 taps and shows its meaning beside the position', async () => {
    const user = userEvent.setup();
    const { reading } = await startCelticCross(user);
    const mago = seedCard('major-01');

    await user.click(positionButton('1 · Situación actual')); // tap 1
    const picker = screen.getByRole('dialog', { name: 'Carta para 1 · Situación actual' });
    await user.type(within(picker).getByRole('searchbox'), 'mago');
    await user.click(within(picker).getByRole('button', { name: 'El Mago' })); // tap 2

    const panel = await screen.findByRole('dialog', { name: '1 · Situación actual' });
    expect(within(panel).getByRole('heading', { name: 'El Mago' })).toBeVisible();
    expect(within(panel).getByText(mago.upright)).toBeVisible();
    expect(within(panel).getByText(mago.keywords.join(', '), { exact: false })).toBeVisible();
    expect(within(panel).getByText('Posición: Situación actual')).toBeVisible();
    const seedPosition = reading.spread_snapshot.positions[0];
    expect(within(panel).getByText(seedPosition?.meaning ?? '')).toBeVisible();
    expect(await db.card_draw.get(drawId(reading.id, 1))).toMatchObject({
      card_id: 'major-01',
      reversed: false,
    });

    // Reversed: the meaning switches and the image turns.
    await user.click(within(panel).getByRole('button', { name: es.cards.field.reversed }));
    expect(await within(panel).findByText(mago.reversed)).toBeVisible();
    expect(panel.querySelector('img')).toHaveAttribute('data-reversed', 'true');
    expect(panel.querySelector('img')).toHaveClass('rotate-180');

    await user.click(within(panel).getByRole('button', { name: es.common.close }));
    expect(positionButton('1 · Situación actual')).toHaveAccessibleName(
      '1 · Situación actual: El Mago, invertida',
    );
    expect(screen.getByTestId('spread-grid').querySelector('img')).toHaveClass('rotate-180');
  });

  it('picks a card by browsing a suit in 3 taps, reversed set beforehand', async () => {
    const user = userEvent.setup();
    const { reading } = await startCelticCross(user);

    await user.click(positionButton('2 · Desafío')); // tap 1
    const picker = screen.getByRole('dialog');
    await user.click(within(picker).getByRole('button', { name: es.cards.field.reversed }));
    expect(picker.querySelector('img')).toHaveClass('rotate-180');
    await user.click(within(picker).getByRole('button', { name: es.cards.suit.cups })); // tap 2
    await user.click(within(picker).getByRole('button', { name: 'Siete de Copas' })); // tap 3

    await screen.findByRole('dialog', { name: '2 · Desafío' });
    expect(await db.card_draw.get(drawId(reading.id, 2))).toMatchObject({
      card_id: 'cups-07',
      reversed: true,
    });
  });

  it('warns before placing the same card twice and allows an override', async () => {
    const user = userEvent.setup();
    const { reading } = await startCelticCross(user);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false });

    await user.click(positionButton('3 · Base'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'El Mago' }));
    const warning = screen.getByRole('alertdialog', { name: es.spreads.picker.duplicate.title });
    expect(warning).toHaveTextContent('El Mago ya está en la posición 1.');

    await user.click(within(warning).getByRole('button', { name: es.common.cancel }));
    expect(await db.card_draw.get(drawId(reading.id, 3))).toBeUndefined();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'El Mago' }));
    await user.click(screen.getByRole('button', { name: es.spreads.picker.duplicate.confirm }));
    await screen.findByRole('dialog', { name: '3 · Base' });
    expect(await db.card_draw.get(drawId(reading.id, 3))).toMatchObject({ card_id: 'major-01' });
  });

  it('autosaves the position note and shows her card note read-only', async () => {
    const user = userEvent.setup();
    await repos.card_note.create({ card_id: 'major-01', note: 'Me sale cuando hay proyectos' });
    const reading = await createReading(db, session.id, CELTIC_CROSS);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false });
    renderAt(`/sessions/${session.id}/readings/${reading.id}`);

    await user.click(await screen.findByRole('button', { name: /^1 · Situación actual:/ }));
    const panel = screen.getByRole('dialog', { name: '1 · Situación actual' });
    expect(await within(panel).findByText('Me sale cuando hay proyectos')).toBeVisible();
    expect(within(panel).getByText(es.spreads.panel.cardNote)).toBeVisible();
    expect(within(panel).getAllByRole('textbox')).toHaveLength(1);

    await user.type(within(panel).getByLabelText(es.spreads.panel.drawNote), 'Nuevo empleo');
    await user.click(within(panel).getByRole('button', { name: es.common.close }));
    await waitFor(async () => {
      expect((await db.card_draw.get(drawId(reading.id, 1)))?.note).toBe('Nuevo empleo');
    });
  });

  it('removes a card from a position and stops showing it', async () => {
    const user = userEvent.setup();
    const reading = await createReading(db, session.id, CELTIC_CROSS);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false });
    await placeCard(db, reading.id, 4, { card_id: 'cups-02', reversed: false });
    await removeCard(db, reading.id, 4);
    renderAt(`/sessions/${session.id}/readings/${reading.id}`);

    expect(
      await screen.findByRole('button', { name: '4 · Pasado reciente: sin carta' }),
    ).toBeVisible();
    expect(screen.getByTestId('spread-grid').querySelectorAll('img')).toHaveLength(1);

    await user.click(positionButton('1 · Situación actual'));
    await user.click(screen.getByRole('button', { name: es.spreads.panel.remove }));
    expect(
      await screen.findByRole('button', { name: '1 · Situación actual: sin carta' }),
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('spread-grid').querySelectorAll('img')).toHaveLength(0);
  });

  it('renders a past reading from its snapshot, not the edited or deleted template', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS);
    const template = await repos.spread_template.get(CELTIC_CROSS);
    if (!template) throw new Error('seed spread missing');
    await repos.spread_template.update(CELTIC_CROSS, {
      name: 'Cruz editada',
      positions: template.positions.slice(0, 3).map((p) => ({ ...p, name: 'Otra', layout: null })),
    });
    await repos.spread_template.remove(CELTIC_CROSS);

    renderAt(`/sessions/${session.id}/readings/${reading.id}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Cruz Celta' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /sin carta$/ })).toHaveLength(10);
    expect(positionButton('10 · Resultado')).toBeVisible();
    expect(screen.queryByText(/Otra/)).not.toBeInTheDocument();
    expect(screen.getByTestId('spread-grid').querySelectorAll('[data-position]')).toHaveLength(10);
  });

  it('shows a spread without placement as a list only', async () => {
    const custom = await repos.spread_template.create({
      name: 'Mi tirada',
      description: '',
      positions: [
        { index: 1, name: 'Uno', meaning: 'Primero', layout: null },
        { index: 2, name: 'Dos', meaning: 'Segundo', layout: null },
      ],
      is_seed: false,
      seed_key: null,
    });
    const reading = await createReading(db, session.id, custom.id);
    renderAt(`/sessions/${session.id}/readings/${reading.id}`);

    expect(await screen.findByRole('button', { name: '2 · Dos: sin carta' })).toBeVisible();
    expect(screen.queryByTestId('spread-grid')).not.toBeInTheDocument();
  });

  it('deletes a reading and its cards after confirming', async () => {
    const user = userEvent.setup();
    const reading = await createReading(db, session.id, CELTIC_CROSS);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false });
    await placeCard(db, reading.id, 2, { card_id: 'major-02', reversed: false });
    const router = renderAt(`/sessions/${session.id}/readings/${reading.id}`);

    await user.click(await screen.findByRole('button', { name: es.spreads.reading.delete.button }));
    const dialog = screen.getByRole('alertdialog', { name: es.spreads.reading.delete.title });
    expect(dialog).toHaveTextContent('Se eliminarán la tirada y 2 cartas colocadas.');
    await user.click(
      within(dialog).getByRole('button', { name: es.spreads.reading.delete.confirm }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/sessions/${session.id}`);
    });
    expect(await screen.findByText(es.sessions.readings.empty)).toBeVisible();
    expect(await repos.reading.get(reading.id)).toBeUndefined();
    expect(await repos.card_draw.get(drawId(reading.id, 1))).toBeUndefined();
  });

  it('lists the session readings with how many cards are placed', async () => {
    const reading = await createReading(db, session.id, CELTIC_CROSS);
    await placeCard(db, reading.id, 1, { card_id: 'major-01', reversed: false });
    renderAt(`/sessions/${session.id}`);

    const link = await screen.findByRole('link', { name: /Cruz Celta/ });
    expect(link).toHaveTextContent('1 de 10 cartas');
    expect(link).toHaveAttribute('href', `/sessions/${session.id}/readings/${reading.id}`);
  });
});

describe('a new session with a reading', () => {
  it('is kept: opening its readings is not leaving it', async () => {
    const user = userEvent.setup();
    renderAt(`/clients/${session.client_id}`);
    await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
    await screen.findByRole('heading', { level: 1, name: 'Sesión con Ana Prueba' });
    const fresh = (await repos.session.list()).find((s) => s.id !== session.id);
    if (!fresh) throw new Error('session not created');

    await user.click(screen.getByRole('link', { name: es.sessions.readings.new }));
    await user.click(await screen.findByRole('button', { name: /^1 carta/ }));
    await screen.findByRole('heading', { level: 1, name: '1 carta' });
    expect(await repos.session.get(fresh.id)).toBeDefined();

    await user.click(screen.getByRole('link', { name: `← ${es.common.back}` }));
    await user.click(await screen.findByRole('link', { name: `← ${es.common.back}` }));
    await screen.findByRole('button', { name: es.clients.detail.newSession });
    await waitFor(async () => {
      expect(await db.meta.get(`fresh_session:${fresh.id}`)).toBeUndefined();
    });
    expect(await repos.session.get(fresh.id)).toBeDefined();
  });
});
