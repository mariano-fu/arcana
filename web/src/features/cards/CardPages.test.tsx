import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb } from '../clients/test-utils';
import { cardNoteId, saveCardNote } from './actions';

const R = es.cards.reference;

const cardCount = () => within(screen.getByRole('main')).getAllByRole('listitem').length;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

beforeEach(async () => {
  await clearDb();
});

describe('card list', () => {
  it('is a tab, browses by group and searches by name or number', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/');
    await user.click(screen.getByRole('link', { name: es.nav.cards }));
    await screen.findByRole('heading', { level: 1, name: R.title });

    expect(cardCount()).toBe(22);
    expect(screen.getByRole('link', { name: 'El Loco' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: es.cards.suit.cups }));
    expect(cardCount()).toBe(14);
    expect(router.state.location.search).toBe('?group=cups');

    await user.type(screen.getByRole('searchbox'), 'mago');
    expect(screen.getByRole('link', { name: 'El Mago' })).toBeVisible();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No hay cartas que coincidan con «zzz».')).toBeVisible();
  });

  it('marks cards she has a note on and returns to the same tab', async () => {
    const user = userEvent.setup();
    await saveCardNote(db, 'cups-02', 'Pareja');
    const { router } = renderAt('/cards?group=cups');

    await user.click(await screen.findByRole('link', { name: 'Dos de Copas, con nota' }));
    await screen.findByRole('heading', { level: 1, name: 'Dos de Copas' });
    await user.click(screen.getByRole('link', { name: R.back }));
    await screen.findByRole('heading', { level: 1, name: R.title });
    expect(router.state.location.search).toBe('?group=cups');
  });
});

describe('card detail', () => {
  it('shows one orientation at a time, with keywords and astrology', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/cards/major-01');
    await screen.findByRole('heading', { level: 1, name: 'El Mago' });
    const card = (await import('../../seed/cards')).cardsSeed.cards.find(
      (c) => c.key === 'major-01',
    );
    if (!card) throw new Error('no El Mago');

    const orientation = screen.getByRole('group', { name: R.orientation });
    expect(within(orientation).getByRole('button', { name: R.upright })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(card.upright)).toBeVisible();
    expect(screen.queryByText(card.reversed)).not.toBeInTheDocument();
    expect(screen.getByText(card.keywords.join(', '))).toBeVisible();
    expect(
      screen.getByText(`${es.cards.field.astrology}: ${String(card.astrology)}`),
    ).toBeVisible();
    expect(container.querySelector('img')).toHaveAttribute('data-reversed', 'false');

    await user.click(within(orientation).getByRole('button', { name: R.reversed }));
    expect(screen.getByText(card.reversed)).toBeVisible();
    expect(screen.queryByText(card.upright)).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('data-reversed', 'true');
  });

  it('shows the suit and element of a minor card', async () => {
    renderAt('/cards/swords-03');
    await screen.findByRole('heading', { level: 1, name: 'Tres de Espadas' });
    expect(screen.getByText('Arcanos Menores · Espadas')).toBeVisible();
    expect(screen.getByText('Elemento: Aire')).toBeVisible();
  });

  it('autosaves her note, keeps it after a reload and clears it', async () => {
    const user = userEvent.setup();
    const first = renderAt('/cards/major-01');
    await user.type(await screen.findByLabelText(R.note), 'Proyectos nuevos');
    await user.tab();
    await waitFor(async () => {
      expect((await db.card_note.get(cardNoteId('major-01')))?.note).toBe('Proyectos nuevos');
    });
    expect(screen.getByText(es.sessions.save.saved)).toBeVisible();
    first.unmount();

    renderAt('/cards/major-01');
    const field = await screen.findByLabelText(R.note);
    await waitFor(() => {
      expect(field).toHaveValue('Proyectos nuevos');
    });
    await user.clear(field);
    await user.tab();
    await waitFor(async () => {
      expect((await db.card_note.get(cardNoteId('major-01')))?.deleted_at).not.toBeNull();
    });
  });

  it('saves a pending note when she leaves the page before the pause', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/cards/major-02');
    await user.type(await screen.findByLabelText(R.note), 'Intuición');
    await router.navigate('/cards');
    await waitFor(async () => {
      expect((await db.card_note.get(cardNoteId('major-02')))?.note).toBe('Intuición');
    });
  });

  it('shows not found for an unknown card', async () => {
    renderAt('/cards/major-99');
    expect(await screen.findByText(es.common.notFound)).toBeVisible();
  });
});
