import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { repos, type NewRow, type Session } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';
import { todayLocal } from './form';

const NBSP = ' ';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function openSession(overrides: Partial<NewRow<Session>> = {}) {
  const user = userEvent.setup();
  const client = await repos.client.create(newClient());
  const session = await repos.session.create(newSession(client.id, overrides));
  renderAt(`/sessions/${session.id}`);
  await screen.findByRole('heading', { level: 2, name: es.payments.section.title });
  return { user, client, session };
}

/** The session page's "Pagos" section. */
function paymentsSection(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: es.payments.section.title });
  const section = heading.closest('section');
  if (!section) throw new Error('no payments section');
  return section;
}

function form(name: string) {
  return screen.getByRole('form', { name });
}

beforeEach(clearDb);

describe('session payments', () => {
  it('records a payment with SINPE Móvil, today and the price as defaults', async () => {
    const { user, session } = await openSession({ price_minor: 1_500_000 });
    const section = paymentsSection();
    expect(within(section).getByText(es.payments.status.pending)).toBeVisible();
    expect(within(section).getByText(es.payments.section.empty)).toBeVisible();

    await user.click(within(section).getByRole('button', { name: es.payments.section.add }));
    const add = form(es.payments.form.addTitle);
    expect(within(add).getByLabelText(es.payments.field.amount)).toHaveValue(`15${NBSP}000`);
    expect(within(add).getByLabelText(es.payments.field.currency)).toHaveValue('CRC');
    expect(within(add).getByRole('button', { name: es.payments.method.sinpe })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(add).getByLabelText(es.payments.field.paidAt)).toHaveValue(todayLocal());

    await user.type(within(add).getByLabelText(es.payments.field.reference), '12345678');
    await user.click(within(add).getByRole('button', { name: es.common.save }));

    const list = await within(section).findByRole('list', { name: es.payments.section.list });
    expect(within(list).getByText(`₡15 000`)).toBeVisible();
    expect(list).toHaveTextContent('SINPE Móvil');
    expect(list).toHaveTextContent('Ref. 12345678');
    expect(within(section).getByText(es.payments.status.paid)).toBeVisible();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();

    const [payment] = await repos.payment.list();
    expect(payment).toMatchObject({
      session_id: session.id,
      client_id: session.client_id,
      amount_minor: 1_500_000,
      currency: 'CRC',
      method: 'sinpe',
      paid_at: todayLocal(),
      reference: '12345678',
    });
  });

  it('suggests what is still owed and shows a partial status', async () => {
    const { user, session } = await openSession({ price_minor: 1_500_000 });
    await repos.payment.create(newPayment(session, { amount_minor: 1_000_000 }));
    const section = paymentsSection();

    expect(await within(section).findByText(es.payments.status.partial)).toBeVisible();
    expect(section).toHaveTextContent(`Pagado ₡10 000 de ₡15 000. Falta ₡5 000.`);

    await user.click(within(section).getByRole('button', { name: es.payments.section.add }));
    expect(
      within(form(es.payments.form.addTitle)).getByLabelText(es.payments.field.amount),
    ).toHaveValue(`5${NBSP}000`);
  });

  it('leaves the amount empty without a price and requires one to save', async () => {
    const { user } = await openSession();
    const section = paymentsSection();
    expect(within(section).getByText(es.payments.status.no_charge)).toBeVisible();

    await user.click(within(section).getByRole('button', { name: es.payments.section.add }));
    const add = form(es.payments.form.addTitle);
    expect(within(add).getByLabelText(es.payments.field.amount)).toHaveValue('');

    await user.click(within(add).getByRole('button', { name: es.common.save }));

    expect(within(add).getByRole('alert')).toHaveTextContent(es.payments.error.amount);
    expect(await repos.payment.list()).toHaveLength(0);
  });

  it('cancels adding a payment without saving it', async () => {
    const { user } = await openSession({ price_minor: 1_500_000 });
    const section = paymentsSection();

    await user.click(within(section).getByRole('button', { name: es.payments.section.add }));
    await user.click(
      within(form(es.payments.form.addTitle)).getByRole('button', { name: es.common.cancel }),
    );

    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(await repos.payment.list()).toHaveLength(0);
  });

  it('edits a payment and flags an overpayment as saldo a favor', async () => {
    const { user, session } = await openSession({ price_minor: 1_500_000 });
    const payment = await repos.payment.create(newPayment(session, { amount_minor: 1_500_000 }));
    const section = paymentsSection();

    await user.click(await within(section).findByRole('button', { name: /₡15.000/ }));
    const edit = form(es.payments.form.editTitle);
    const amount = within(edit).getByLabelText(es.payments.field.amount);
    await user.clear(amount);
    await user.type(amount, '17 000');
    await user.click(within(edit).getByRole('button', { name: es.payments.method.cash }));
    await user.click(within(edit).getByRole('button', { name: es.common.save }));

    expect(await within(section).findByText(es.payments.status.overpaid)).toBeVisible();
    expect(section).toHaveTextContent(`Saldo a favor: ₡2 000.`);
    expect(await repos.payment.get(payment.id)).toMatchObject({
      amount_minor: 1_700_000,
      method: 'cash',
    });
  });

  it('deletes a payment after confirming', async () => {
    const { user, session } = await openSession({ price_minor: 1_500_000 });
    const payment = await repos.payment.create(newPayment(session, { amount_minor: 1_000_000 }));
    const section = paymentsSection();

    await user.click(await within(section).findByRole('button', { name: /₡10.000/ }));
    const edit = form(es.payments.form.editTitle);
    await user.click(within(edit).getByRole('button', { name: es.payments.delete.button }));
    expect(within(edit).getByRole('alert')).toHaveTextContent(`¿Eliminar este pago de ₡10 000?`);
    await user.click(within(edit).getByRole('button', { name: es.payments.delete.yes }));

    expect(await within(section).findByText(es.payments.section.empty)).toBeVisible();
    expect(within(section).getByText(es.payments.status.pending)).toBeVisible();
    expect(await repos.payment.get(payment.id)).toBeUndefined();
  });

  it('shows a payment in the other currency without counting it', async () => {
    const { session } = await openSession({ price_minor: 1_500_000 });
    await repos.payment.create(newPayment(session, { amount_minor: 2_000, currency: 'USD' }));
    const section = paymentsSection();

    expect(
      await within(section).findByText(
        'Además, en otra moneda: US$20,00. No cuenta para el estado del pago.',
      ),
    ).toBeVisible();
    expect(within(section).getByText(es.payments.status.pending)).toBeVisible();
  });

  it('keeps a new session once it has a payment', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(newClient());
    renderAt(`/clients/${client.id}`);
    await user.click(await screen.findByRole('button', { name: es.clients.detail.newSession }));
    await screen.findByRole('heading', { level: 1, name: `Sesión con ${client.name}` });

    await user.click(await screen.findByRole('button', { name: es.payments.section.add }));
    const add = form(es.payments.form.addTitle);
    await user.type(within(add).getByLabelText(es.payments.field.amount), '5000');
    await user.click(within(add).getByRole('button', { name: es.common.save }));
    await within(paymentsSection()).findByRole('list', { name: es.payments.section.list });

    await user.click(screen.getByRole('link', { name: `← ${es.common.back}` }));
    await screen.findByRole('button', { name: es.clients.detail.newSession });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await repos.session.list()).toHaveLength(1);
  });
});

describe('client payments', () => {
  it('shows a status badge on each session in the timeline', async () => {
    const client = await repos.client.create(newClient());
    const paid = await repos.session.create(
      newSession(client.id, { started_at: '2026-10-10T15:00:00.000Z', price_minor: 1_500_000 }),
    );
    await repos.payment.create(newPayment(paid, { amount_minor: 1_500_000 }));
    await repos.session.create(
      newSession(client.id, { started_at: '2026-09-01T15:00:00.000Z', price_minor: 1_500_000 }),
    );
    await repos.session.create(newSession(client.id, { started_at: '2026-08-01T15:00:00.000Z' }));
    renderAt(`/clients/${client.id}`);

    const list = await screen.findByRole('list', { name: es.clients.detail.sessions });
    const items = within(list).getAllByRole('link');
    expect(items[0]).toHaveTextContent(es.payments.status.paid);
    expect(items[1]).toHaveTextContent(es.payments.status.pending);
    expect(items[2]).toHaveTextContent(es.payments.status.no_charge);
  });

  it('shows totals paid, pending and saldo a favor per currency, without netting', async () => {
    const client = await repos.client.create(newClient());
    const over = await repos.session.create(newSession(client.id, { price_minor: 1_500_000 }));
    await repos.payment.create(newPayment(over, { amount_minor: 1_700_000 }));
    await repos.session.create(newSession(client.id, { price_minor: 1_000_000 }));
    const usd = await repos.session.create(
      newSession(client.id, { price_minor: 5_000, currency: 'USD' }),
    );
    await repos.payment.create(newPayment(usd, { amount_minor: 2_000, currency: 'USD' }));
    renderAt(`/clients/${client.id}`);

    const summary = (await screen.findByText(es.payments.client.paid)).closest('dl');
    if (!summary) throw new Error('no summary');
    const row = (label: string) => within(summary).getByText(label).parentElement;
    expect(row(es.payments.client.paid)).toHaveTextContent(`₡17 000 y US$20,00`);
    expect(row(es.payments.client.pending)).toHaveTextContent(`₡10 000 y US$30,00`);
    expect(row(es.payments.client.credit)).toHaveTextContent(`₡2 000`);
  });

  it('says so when there is nothing paid or owed', async () => {
    const client = await repos.client.create(newClient());
    await repos.session.create(newSession(client.id));
    renderAt(`/clients/${client.id}`);

    expect(await screen.findByText(es.payments.client.none)).toBeVisible();
  });
});
