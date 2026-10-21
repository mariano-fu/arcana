import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../../app/routes';
import { db, repos, type Session } from '../../../db';
import es from '../../../i18n/locales/es.json';
import { loadSeed, seedId } from '../../../seed/loader';
import { clearDb, newClient, newSession } from '../../clients/test-utils';
import { createReading } from '../actions';
import { createCustomSpread } from './actions';

type User = ReturnType<typeof userEvent.setup>;

const CELTIC_CROSS = seedId('spread_template', 'celtic-cross');
const L = es.spreads.builder;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const cell = (row: number, col: number) =>
  screen.getByRole('button', {
    name: new RegExp(`^Fila ${String(row)}, columna ${String(col)}(:|$)`),
  });

/** The sticky header's "Guardar" (the form has a second one at the bottom). */
async function save(user: User) {
  const [top] = screen.getAllByRole('button', { name: es.common.save });
  if (!top) throw new Error('no Guardar button');
  await user.click(top);
}

/** Fills the editor: spread name and position names (adding rows as needed). */
async function fillSpread(user: User, name: string, positions: string[]) {
  await user.type(screen.getByLabelText(L.form.name), name);
  for (const [i, position] of positions.entries()) {
    if (i > 0) await user.click(screen.getByRole('button', { name: L.form.add }));
    await user.type(screen.getByLabelText(`Nombre de la posición ${String(i + 1)}`), position);
  }
}

let session: Session;

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
  const client = await repos.client.create(newClient({ name: 'Ana Prueba' }));
  session = await repos.session.create(newSession(client.id));
});

describe('custom spread builder', () => {
  it('returns to the same session chooser after "Crear tirada propia", without discarding it', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/clients/${session.client_id}`);
    await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
    await screen.findByRole('heading', { level: 1, name: 'Sesión con Ana Prueba' });
    const fresh = (await repos.session.list()).find((s) => s.id !== session.id);
    if (!fresh) throw new Error('session not created');

    await user.click(screen.getByRole('link', { name: es.sessions.readings.new }));
    await user.click(await screen.findByRole('link', { name: es.spreads.chooser.create }));
    await screen.findByRole('heading', { name: L.form.newTitle });
    expect(router.state.location.pathname).toBe(`/sessions/${fresh.id}/spreads/new`);

    await fillSpread(user, 'Tirada del día', ['Energía', 'Consejo']);
    await user.click(cell(1, 1)); // position 1 is picked first
    await user.click(cell(1, 2)); // then the next unplaced one
    await save(user);

    await screen.findByRole('heading', { name: es.spreads.chooser.title });
    expect(router.state.location.pathname).toBe(`/sessions/${fresh.id}/readings/new`);
    expect(await repos.session.get(fresh.id)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /^Tirada del día/ }));
    await screen.findByRole('heading', { level: 1, name: 'Tirada del día' });
    expect(screen.getByTestId('spread-grid').querySelectorAll('[data-position]')).toHaveLength(2);
  });

  it('mixes placed and unplaced positions: grid for some, list for all', async () => {
    const user = userEvent.setup();
    renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });
    await fillSpread(user, 'Mixta', ['Uno', 'Dos', 'Tres', 'Cuatro']);
    await user.click(cell(1, 1)); // 1
    await user.click(screen.getByRole('button', { name: '3', pressed: false }));
    await user.click(cell(1, 3)); // 3
    await save(user);

    await user.click(await screen.findByRole('button', { name: /^Mixta/ }));
    await screen.findByRole('heading', { level: 1, name: 'Mixta' });
    const grid = screen.getByTestId('spread-grid');
    expect(
      [...grid.querySelectorAll('[data-position]')].map((el) => el.getAttribute('data-position')),
    ).toEqual(['1', '3']);
    expect(screen.getAllByRole('button', { name: /sin carta$/ })).toHaveLength(4);

    const [reading] = await repos.reading.list();
    expect(reading?.spread_snapshot.positions.map((p) => p.layout)).toEqual([
      { col: 0, row: 0, rotated: false },
      null,
      { col: 2, row: 0, rotated: false },
      null,
    ]);
  });

  it('lays a position crosswise with "Cruzada" and takes it off with "Sin lugar"', async () => {
    const user = userEvent.setup();
    renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });
    await fillSpread(user, 'Cruce', ['Base', 'Cruce']);
    await user.click(cell(2, 2));
    await user.click(screen.getByRole('button', { name: L.layout.crossed }));
    await user.click(cell(2, 2));

    expect(cell(2, 2)).toHaveAccessibleName('Fila 2, columna 2: 1, 2 cruzada');
    expect(screen.getByText('Fila 2, columna 2, cruzada')).toBeVisible();

    await user.click(screen.getByRole('button', { name: L.layout.none }));
    expect(cell(2, 2)).toHaveAccessibleName('Fila 2, columna 2: 1');
  });

  it('swaps two positions when one is placed on an occupied cell', async () => {
    const user = userEvent.setup();
    renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });
    await fillSpread(user, 'Cambio', ['Uno', 'Dos']);
    await user.click(cell(1, 1)); // 1
    await user.click(cell(1, 2)); // 2, still picked: nothing is left unplaced
    expect(screen.getByRole('button', { name: '2', pressed: true })).toBeVisible();
    await user.click(cell(1, 1));

    expect(cell(1, 1)).toHaveAccessibleName('Fila 1, columna 1: 2');
    expect(cell(1, 2)).toHaveAccessibleName('Fila 1, columna 2: 1');
  });

  it('rejects a name that a seed or custom spread already has', async () => {
    const user = userEvent.setup();
    await createCustomSpread(db, {
      name: 'Tirada del Corazón',
      description: '',
      positions: [{ index: 1, name: 'Uno', meaning: '', layout: null }],
    });
    const router = renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });
    await fillSpread(user, ' CRUZ CÉLTA ', ['Uno']);
    await save(user);

    expect(await screen.findByText(L.error.nameTaken)).toBeVisible();
    await user.clear(screen.getByLabelText(L.form.name));
    await user.type(screen.getByLabelText(L.form.name), 'tirada del corazon');
    await save(user);
    expect(await screen.findByText(L.error.nameTaken)).toBeVisible();
    expect(router.state.location.pathname).toBe(`/sessions/${session.id}/spreads/new`);
  });

  it('asks before discarding unsaved changes', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });
    await user.type(screen.getByLabelText(L.form.name), 'A medias');

    await user.click(screen.getByRole('link', { name: es.nav.clients }));
    const dialog = screen.getByRole('alertdialog', { name: L.leave.title });
    await user.click(within(dialog).getByRole('button', { name: L.leave.cancel }));
    expect(router.state.location.pathname).toBe(`/sessions/${session.id}/spreads/new`);
    expect(screen.getByLabelText(L.form.name)).toHaveValue('A medias');

    await user.click(screen.getByRole('link', { name: es.nav.clients }));
    await user.click(screen.getByRole('button', { name: L.leave.confirm }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/clients');
    });
  });

  it('leaves without asking when nothing changed', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/sessions/${session.id}/spreads/new`);
    await screen.findByRole('heading', { name: L.form.newTitle });

    await user.click(screen.getByRole('link', { name: es.nav.clients }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/clients');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('duplicates the Cruz Celta from "Mis tiradas", edits the copy and leaves the seed alone', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/sessions/${session.id}/readings/new`);
    await user.click(await screen.findByRole('link', { name: es.spreads.chooser.manage }));
    await screen.findByRole('heading', { level: 1, name: L.list.title });
    expect(screen.getByText(L.list.empty)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Duplicar Cruz Celta' }));
    await screen.findByRole('heading', { name: L.form.editTitle });
    expect(screen.getByLabelText(L.form.name)).toHaveValue('Cruz Celta (copia)');

    await user.click(screen.getByRole('button', { name: 'Quitar posición 5' }));
    await save(user);

    await screen.findByRole('heading', { level: 1, name: L.list.title });
    expect(router.state.location.pathname).toBe(`/sessions/${session.id}/spreads`);
    expect(screen.getByRole('link', { name: /Cruz Celta \(copia\)/ })).toHaveTextContent(
      '9 cartas',
    );
    const seed = await repos.spread_template.get(CELTIC_CROSS);
    expect(seed?.positions).toHaveLength(10);
    const copy = (await repos.spread_template.list()).find((t) => t.name === 'Cruz Celta (copia)');
    expect(copy?.positions.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await user.click(screen.getByRole('button', { name: 'Duplicar Cruz Celta' }));
    await screen.findByRole('heading', { name: L.form.editTitle });
    expect(screen.getByLabelText(L.form.name)).toHaveValue('Cruz Celta (copia 2)');
  });

  it('deletes a custom spread: gone from the lists, past readings still open', async () => {
    const user = userEvent.setup();
    const template = await createCustomSpread(db, {
      name: 'Tirada vieja',
      description: '',
      positions: [{ index: 1, name: 'Única', meaning: 'Lo esencial', layout: null }],
    });
    const reading = await createReading(db, session.id, template.id);
    const router = renderAt(`/sessions/${session.id}/spreads/${template.id}/edit`);

    await user.click(await screen.findByRole('button', { name: L.form.delete.button }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: L.form.delete.confirm }),
    );
    await screen.findByRole('heading', { level: 1, name: L.list.title });
    expect(screen.queryByText('Tirada vieja')).not.toBeInTheDocument();
    expect((await db.spread_template.get(template.id))?.deleted_at).not.toBeNull();

    await router.navigate(`/sessions/${session.id}/readings/new`);
    await screen.findByRole('heading', { name: es.spreads.chooser.title });
    expect(screen.queryByRole('button', { name: /Tirada vieja/ })).not.toBeInTheDocument();

    await router.navigate(`/sessions/${session.id}/readings/${reading.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tirada vieja' })).toBeVisible();
    expect(screen.getByRole('button', { name: '1 · Única: sin carta' })).toBeVisible();
  });

  it('does not open a seed spread in the editor', async () => {
    renderAt(`/sessions/${session.id}/spreads/${CELTIC_CROSS}/edit`);
    expect(await screen.findByText(es.common.notFound)).toBeVisible();
  });
});
