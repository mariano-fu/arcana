import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { loadSeed, seedId } from '../../seed/loader';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { attachCrystal, sessionCrystalId } from './actions';

const t = es.crystals.session;
const ROSE = seedId('crystal', 'rose-quartz');
const AMETHYST = seedId('crystal', 'amethyst');

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function openSession(overrides: Parameters<typeof newClient>[0] = {}) {
  const user = userEvent.setup();
  const client = await repos.client.create(newClient(overrides));
  const session = await repos.session.create(newSession(client.id));
  renderAt(`/sessions/${session.id}`);
  const heading = await screen.findByRole('heading', { level: 2, name: t.title });
  const element = heading.closest('section');
  if (element === null) throw new Error('no crystals section');
  return { user, client, session, element, section: within(element) };
}

/** The attached list: the first list in the section (the recommendations are an `ol`). */
function attachedNames(element: HTMLElement): string[] {
  const list = element.querySelector('ul');
  if (list === null) return [];
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('span')?.textContent ?? '');
}

describe('crystals in a session', () => {
  it('starts empty, with the client’s recommendations to attach', async () => {
    // 5 April: Aries. The top 5 by name, as on client detail.
    const { element, section } = await openSession({ birth_date: '1990-04-05' });

    expect(await section.findByText(t.empty)).toBeVisible();
    await section.findByText(es.crystals.recommend.more);
    expect(section.getAllByRole('button', { name: /^Agregar .* a la sesión$/ })).toHaveLength(5);
    expect(attachedNames(element)).toEqual([]);
  });

  it('attaches a recommendation, which then shows a disabled "En la sesión"', async () => {
    const { user, session, element, section } = await openSession({ birth_date: '1990-04-05' });

    await user.click(await section.findByRole('button', { name: 'Agregar Citrino a la sesión' }));

    await waitFor(() => {
      expect(attachedNames(element)).toEqual(['Citrino']);
    });
    expect(section.queryByText(t.empty)).toBeNull();
    const added = section.getByRole('button', { name: 'Citrino ya está en la sesión' });
    expect(added).toBeDisabled();
    expect(added).toHaveTextContent(t.added);
    expect(section.queryByRole('button', { name: 'Agregar Citrino a la sesión' })).toBeNull();
    expect(await repos.session_crystal.list()).toEqual([
      expect.objectContaining({ session_id: session.id, crystal_id: seedId('crystal', 'citrine') }),
    ]);
  });

  it('removes a crystal only from the attached list, and it can be attached again', async () => {
    const { user, session, element, section } = await openSession({ birth_date: '1990-04-05' });
    await attachCrystal(db, session.id, seedId('crystal', 'citrine'));
    await section.findByRole('button', { name: 'Quitar Citrino de la sesión' });

    await user.click(section.getByRole('button', { name: 'Quitar Citrino de la sesión' }));

    expect(await section.findByText(t.empty)).toBeVisible();
    expect(attachedNames(element)).toEqual([]);
    await user.click(section.getByRole('button', { name: 'Agregar Citrino a la sesión' }));
    await waitFor(() => {
      expect(attachedNames(element)).toEqual(['Citrino']);
    });
    // The same row, revived.
    expect(await db.session_crystal.toArray()).toEqual([
      expect.objectContaining({
        id: sessionCrystalId(session.id, seedId('crystal', 'citrine')),
        deleted_at: null,
      }),
    ]);
  });

  it('labels an attached crystal hidden or deleted since', async () => {
    const { session, element } = await openSession();
    await attachCrystal(db, session.id, ROSE);
    await attachCrystal(db, session.id, AMETHYST);
    await repos.crystal.update(ROSE, { hidden: true });
    await repos.crystal.remove(AMETHYST);

    await waitFor(() => {
      expect(attachedNames(element)).toEqual([`Cuarzo rosa ${t.hidden}`, `Amatista ${t.deleted}`]);
    });
  });

  it('keeps a "Nueva sesión" with an attached crystal when she leaves', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient({ birth_date: '1990-04-05' }));
    renderAt(`/clients/${client.id}`);
    await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
    await user.click(await screen.findByRole('button', { name: 'Agregar Citrino a la sesión' }));
    await screen.findByRole('button', { name: 'Quitar Citrino de la sesión' });
    const [session] = await repos.session.list();
    if (!session) throw new Error('session not created');

    await user.click(screen.getByRole('link', { name: `← ${es.common.back}` }));
    await screen.findByRole('button', { name: es.clients.detail.newSession });
    // Give a deferred discard the chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await repos.session.get(session.id)).toBeDefined();
    expect(await repos.session_crystal.list()).toHaveLength(1);
  });

  it('lists attached crystals in the session delete dialog', async () => {
    const { user, session } = await openSession();
    await attachCrystal(db, session.id, ROSE);
    await attachCrystal(db, session.id, AMETHYST);

    await user.click(await screen.findByRole('button', { name: es.sessions.delete.button }));
    const dialog = screen.getByRole('alertdialog', { name: es.sessions.delete.title });

    expect(await within(dialog).findByText('Se eliminarán la sesión y 2 cristales.')).toBeVisible();
  });

  it('lists crystals in sessions in the client delete dialog', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient({ name: 'Ana Solís' }));
    const session = await repos.session.create(newSession(client.id));
    await attachCrystal(db, session.id, ROSE);
    renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.delete }));
    const dialog = screen.getByRole('alertdialog');

    expect(
      await within(dialog).findByText('Se eliminarán 1 sesión y 1 cristal en una sesión.'),
    ).toBeVisible();
  });
});
