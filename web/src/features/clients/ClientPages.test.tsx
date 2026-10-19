import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb, newClient, seedClientWithHistory } from './test-utils';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(clearDb);

describe('client form', () => {
  it('creates a client with only a name and opens it', async () => {
    const user = userEvent.setup();
    const router = renderAt('/clients/new');

    await user.type(screen.getByLabelText(es.clients.form.name), 'Ana Prueba');
    await user.click(screen.getByRole('button', { name: es.common.save }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' })).toBeVisible();
    const [saved] = await repos.client.list();
    expect(saved).toMatchObject({ name: 'Ana Prueba', birth_date: null, archived: false });
    expect(router.state.location.pathname).toBe(`/clients/${saved?.id ?? ''}`);
    expect(screen.getAllByText(es.clients.detail.astrologyMissingBirthDate)).toHaveLength(1);
  });

  it('shows an error and saves nothing without a name', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.click(screen.getByRole('button', { name: es.common.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(es.clients.form.error.nameRequired);
    expect(await repos.client.list()).toHaveLength(0);
  });

  it('stores "No sabe la hora" as a null birth time', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.type(screen.getByLabelText(es.clients.form.name), 'Ana Prueba');
    await user.type(screen.getByLabelText(es.clients.form.birthDate), '1990-04-12');
    await user.click(screen.getByLabelText(es.clients.form.birthTimeUnknown));
    expect(screen.getByLabelText(es.clients.form.birthTime)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: es.common.save }));

    await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' });
    const [saved] = await repos.client.list();
    expect(saved).toMatchObject({ birth_date: '1990-04-12', birth_time: null });
    expect(screen.getByText(new RegExp(es.clients.detail.birthTimeUnknown))).toBeVisible();
  });

  it('edits an existing client', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient({ name: 'Ana Prueba' }));
    renderAt(`/clients/${client.id}/edit`);

    const name = await screen.findByLabelText(es.clients.form.name);
    await user.clear(name);
    await user.type(name, 'Ana María Prueba');
    await user.click(screen.getByRole('button', { name: es.common.save }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ana María Prueba' }),
    ).toBeVisible();
  });
});

describe('client list', () => {
  it('narrows results as she types, by name or handle', async () => {
    const user = userEvent.setup();
    await repos.client.create(newClient({ name: 'Ana Solís', instagram: 'luna.ana' }));
    await repos.client.create(newClient({ name: 'Pedro Mora' }));
    renderAt('/clients');

    expect(await screen.findByText('Ana Solís')).toBeVisible();
    expect(screen.getByText('Pedro Mora')).toBeVisible();

    await user.type(screen.getByLabelText(es.clients.search.label), '@luna');
    expect(screen.getByText('Ana Solís')).toBeVisible();
    expect(screen.queryByText('Pedro Mora')).not.toBeInTheDocument();
  });

  it('shows "Sin visitas" for clients without sessions', async () => {
    await repos.client.create(newClient({ name: 'Ana Solís' }));
    renderAt('/clients');

    expect(await screen.findByText(es.clients.noVisits)).toBeVisible();
  });

  it('hides archived clients unless asked', async () => {
    const user = userEvent.setup();
    await repos.client.create(newClient({ name: 'Ana Solís', archived: true }));
    await repos.client.create(newClient({ name: 'Pedro Mora' }));
    renderAt('/clients');

    expect(await screen.findByText('Pedro Mora')).toBeVisible();
    expect(screen.queryByText('Ana Solís')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(es.clients.showArchived));
    expect(screen.getByText('Ana Solís')).toBeVisible();
  });

  it('has a bottom navigation', async () => {
    renderAt('/clients');
    const nav = await screen.findByRole('navigation', { name: es.nav.label });
    expect(within(nav).getByRole('link', { name: es.nav.clients })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('client detail', () => {
  it('archives and unarchives', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient({ name: 'Ana Solís' }));
    renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.archive }));
    expect(await screen.findByText(es.clients.archivedBadge)).toBeVisible();
    expect(await repos.client.get(client.id)).toMatchObject({ archived: true });

    await user.click(screen.getByRole('button', { name: es.clients.detail.unarchive }));
    await waitFor(() => {
      expect(screen.queryByText(es.clients.archivedBadge)).not.toBeInTheDocument();
    });
  });

  it('lists what a delete removes, with counts and totals per currency', async () => {
    const user = userEvent.setup();
    const client = await seedClientWithHistory('Ana Solís', 4, [
      { amount_minor: 2000000, currency: 'CRC' },
      { amount_minor: 2500000, currency: 'CRC' },
      { amount_minor: 2000, currency: 'USD' },
    ]);
    renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.delete }));
    const dialog = screen.getByRole('alertdialog');

    // Testing Library collapses the es-CR thousands separator (no-break space) to a space.
    expect(
      await within(dialog).findByText('Se eliminarán 4 sesiones y 3 pagos (₡45 000 y US$20).'),
    ).toBeVisible();
    expect(within(dialog).getByText(es.clients.delete.suggestArchive)).toBeVisible();
  });

  it('uses singular wording for a single session', async () => {
    const user = userEvent.setup();
    const client = await seedClientWithHistory('Ana Solís', 1, []);
    renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.delete }));
    expect(await screen.findByText('Se eliminará 1 sesión.')).toBeVisible();
  });

  it('offers archiving as the main action instead of deleting', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient({ name: 'Ana Solís' }));
    renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.delete }));
    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByText(es.clients.delete.onlyProfile)).toBeVisible();
    const [first] = within(dialog).getAllByRole('button');
    expect(first).toHaveTextContent(es.clients.delete.archiveInstead);

    await user.click(
      within(dialog).getByRole('button', { name: es.clients.delete.archiveInstead }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(async () => {
      expect(await repos.client.get(client.id)).toMatchObject({ archived: true });
    });
  });

  it('deletes after confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    const client = await seedClientWithHistory('Ana Solís', 2, [{}]);
    const router = renderAt(`/clients/${client.id}`);

    await user.click(await screen.findByRole('button', { name: es.clients.detail.delete }));
    await user.click(screen.getByRole('button', { name: es.clients.delete.confirm }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/clients');
    });
    expect(await repos.client.get(client.id)).toBeUndefined();
    expect(await repos.session.list()).toHaveLength(0);
    expect(await repos.payment.list()).toHaveLength(0);
  });
});
