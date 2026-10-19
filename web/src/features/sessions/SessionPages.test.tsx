import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

/** Client page → "Nueva sesión" → session page. */
async function startSession(name = 'Ana Prueba', archived = false) {
  const user = userEvent.setup();
  const client = await repos.client.create(newClient({ name, archived }));
  const router = renderAt(`/clients/${client.id}`);
  await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
  await screen.findByRole('heading', { level: 1, name: `Sesión con ${name}` });
  const [session] = await repos.session.list();
  if (!session) throw new Error('session not created');
  return { user, client, session, router };
}

async function leave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: `← ${es.common.back}` }));
  await screen.findByRole('button', { name: es.clients.detail.newSession });
}

beforeEach(clearDb);

describe('session page', () => {
  it('creates a session from the client page with the defaults', async () => {
    const { client, session, router } = await startSession();

    expect(router.state.location.pathname).toBe(`/sessions/${session.id}`);
    expect(session).toMatchObject({
      client_id: client.id,
      type: 'in_person',
      price_minor: null,
      currency: 'CRC',
    });
    expect(screen.getByRole('button', { name: es.sessions.type.in_person })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText(es.sessions.unarchivedNotice)).not.toBeInTheDocument();
  });

  it('unarchives an archived client and says so', async () => {
    const { client } = await startSession('Ana Prueba', true);

    expect(screen.getByRole('status')).toHaveTextContent(es.sessions.unarchivedNotice);
    expect((await repos.client.get(client.id))?.archived).toBe(false);
  });

  it('autosaves every field without a Save button', async () => {
    const { user, session } = await startSession();
    expect(screen.queryByRole('button', { name: es.common.save })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: es.sessions.type.online }));
    await user.type(screen.getByLabelText(es.sessions.field.price), '40,50');
    await user.selectOptions(screen.getByLabelText(es.sessions.field.currency), 'USD');
    expect(screen.getByText('Se guarda como US$40,50.')).toBeVisible();
    await user.type(screen.getByLabelText(es.sessions.field.notes), 'Pregunta por el trabajo');
    await user.type(screen.getByLabelText(es.sessions.field.followUpNote), 'Revisar en 1 mes');
    await user.type(screen.getByLabelText(es.sessions.field.followUpDate), '2026-11-19');

    await waitFor(async () => {
      expect(await repos.session.get(session.id)).toMatchObject({
        type: 'online',
        price_minor: 4050,
        currency: 'USD',
        notes: 'Pregunta por el trabajo',
        follow_up_note: 'Revisar en 1 mes',
        follow_up_date: '2026-11-19',
      });
    });
    expect(await screen.findByText(es.sessions.save.saved)).toBeVisible();
  });

  it('saves notes typed right before leaving', async () => {
    const { user, session } = await startSession();

    await user.type(screen.getByLabelText(es.sessions.field.notes), 'Carta del Loco');
    await leave(user);

    await waitFor(async () => {
      expect((await repos.session.get(session.id))?.notes).toBe('Carta del Loco');
    });
  });

  it('flags an invalid price and keeps the stored one', async () => {
    const { user, session } = await startSession();
    const price = screen.getByLabelText(es.sessions.field.price);

    await user.type(price, '15 000');
    await user.tab();
    await waitFor(async () => {
      expect((await repos.session.get(session.id))?.price_minor).toBe(1500000);
    });

    await user.clear(price);
    await user.type(price, 'quince');
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent(es.sessions.error.price);
    expect((await repos.session.get(session.id))?.price_minor).toBe(1500000);
  });

  it('discards a session left untouched, and archives the client again', async () => {
    const { user, client, session } = await startSession('Ana Prueba', true);

    await leave(user);

    await waitFor(async () => {
      expect(await repos.session.get(session.id)).toBeUndefined();
    });
    expect((await db.session.get(session.id))?.deleted_at).not.toBeNull();
    expect((await repos.client.get(client.id))?.archived).toBe(true);
    expect(await screen.findByText(es.clients.detail.noSessions)).toBeVisible();
  });

  it("isn't fooled by StrictMode's simulated unmount", async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient());
    const router = createMemoryRouter(routes, { initialEntries: [`/clients/${client.id}`] });
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );

    await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
    await screen.findByLabelText(es.sessions.field.notes);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await repos.session.list()).toHaveLength(1);
    expect(screen.getByLabelText(es.sessions.field.notes)).toBeVisible();
  });

  it('keeps a session reopened from the timeline even if nothing changes', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    renderAt(`/sessions/${session.id}`);
    await screen.findByLabelText(es.sessions.field.notes);

    await leave(user);
    // Give a deferred discard the chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await repos.session.get(session.id)).toBeDefined();
  });

  it('deletes a session after confirming what goes with it', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    const payments = [
      await repos.payment.create(newPayment(session, { amount_minor: 1000000, currency: 'CRC' })),
      await repos.payment.create(newPayment(session, { amount_minor: 2000, currency: 'USD' })),
    ];
    const router = renderAt(`/sessions/${session.id}`);

    await user.click(await screen.findByRole('button', { name: es.sessions.delete.button }));
    const dialog = screen.getByRole('alertdialog', { name: es.sessions.delete.title });
    expect(
      await within(dialog).findByText('Se eliminarán la sesión y 2 pagos (₡10 000 y US$20,00).'),
    ).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: es.sessions.delete.confirm }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/clients/${client.id}`);
    });
    expect(await repos.session.get(session.id)).toBeUndefined();
    for (const payment of payments) expect(await repos.payment.get(payment.id)).toBeUndefined();
  });

  it('says only the session goes when it has no readings or payments', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    renderAt(`/sessions/${session.id}`);

    await user.click(await screen.findByRole('button', { name: es.sessions.delete.button }));

    expect(await screen.findByText(es.sessions.delete.onlySession)).toBeVisible();
  });
});

describe('client timeline', () => {
  it('lists sessions newest first with type, price and follow-up', async () => {
    const client = await repos.client.create(newClient());
    await repos.session.create(
      newSession(client.id, { started_at: '2026-09-01T15:00:00.000Z', type: 'message' }),
    );
    await repos.session.create(
      newSession(client.id, {
        started_at: '2026-10-10T15:00:00.000Z',
        price_minor: 1500000,
        follow_up_date: '2026-11-10',
      }),
    );
    const gone = await repos.session.create(newSession(client.id));
    await repos.session.remove(gone.id);
    await repos.session.create(newSession((await repos.client.create(newClient())).id));
    renderAt(`/clients/${client.id}`);

    const list = await screen.findByRole('list', { name: es.clients.detail.sessions });
    const items = within(list).getAllByRole('link');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('₡15 000');
    expect(items[0]).toHaveTextContent(es.sessions.type.in_person);
    expect(items[0]).toHaveTextContent('Seguimiento: 10 de noviembre de 2026');
    expect(items[1]).toHaveTextContent(es.sessions.timeline.noPrice);
    expect(items[1]).toHaveTextContent(es.sessions.type.message);
  });
});
