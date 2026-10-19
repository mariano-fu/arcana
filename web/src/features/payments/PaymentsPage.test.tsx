import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockInstance } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { repos, type NewRow, type Payment, type Session } from '../../db';
import es from '../../i18n/locales/es.json';
import { stubProperty } from '../../test/stub-property';
import { useTimeZone } from '../../test/time-zone';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';
import { formatMoney } from './money';
import { currentMonth, formatMonth } from './report';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function sessionFor(name: string, overrides: Partial<NewRow<Session>> = {}) {
  const client = await repos.client.create(newClient({ name }));
  return repos.session.create(newSession(client.id, overrides));
}

function pay(session: Session, overrides: Partial<NewRow<Payment>> = {}) {
  return repos.payment.create(newPayment(session, overrides));
}

/**
 * Ana owes ₡15 000 on a September session (paid ₡5 000 in September). Bea owes US$40 on an
 * October session. Carla paid ₡15 000 by SINPE and tipped US$10 by PayPal in October. Plus a
 * November payment and a deleted October one, which October must not show.
 */
async function seed() {
  const ana = await sessionFor('Ana Prueba', {
    started_at: '2026-09-01T15:00:00.000Z',
    price_minor: 2_000_000,
  });
  await pay(ana, { amount_minor: 500_000, paid_at: '2026-09-02', method: 'cash' });

  const bea = await sessionFor('Bea Prueba', {
    started_at: '2026-10-08T15:00:00.000Z',
    price_minor: 4_000,
    currency: 'USD',
  });

  const carla = await sessionFor('Carla Prueba', { price_minor: 1_500_000 });
  await pay(carla, { paid_at: '2026-10-10', reference: '998877' });
  const tip = await repos.session.create(
    newSession(carla.client_id, { started_at: '2026-10-12T15:00:00.000Z' }),
  );
  await pay(tip, {
    amount_minor: 1_000,
    currency: 'USD',
    method: 'paypal',
    paid_at: '2026-10-12',
    note: 'Propina',
  });
  await pay(carla, { amount_minor: 100, paid_at: '2026-11-01' });
  const deleted = await pay(carla, { amount_minor: 777, paid_at: '2026-10-15' });
  await repos.payment.remove(deleted.id);

  return { ana, bea, carla };
}

async function openPayments(query = '?month=2026-10') {
  const router = renderAt(`/payments${query}`);
  await screen.findByRole('heading', { level: 1, name: es.payments.page.title });
  await monthLoaded();
  return router;
}

/** Waits for the selected month's payments (the income section is busy until then). */
async function monthLoaded(month?: string) {
  if (month !== undefined) await screen.findByText(month);
  await waitFor(() => {
    expect(incomeSection()).toHaveAttribute('aria-busy', 'false');
  });
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name });
  const found = heading.closest('section');
  if (!found) throw new Error(`no section ${name}`);
  return found;
}

const incomeSection = () => section(es.payments.page.income.title);
const pendingSection = () => section(es.payments.page.pending.title);
const listSection = (month = 'octubre de 2026') => section(`Pagos de ${month}`);
const paymentRows = (month?: string) =>
  within(within(listSection(month)).getByRole('list', { name: es.payments.page.list.label }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

beforeEach(clearDb);

describe('Pagos screen', () => {
  it('is reachable from the tab bar and opens on the current month', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('link', { name: es.nav.payments }));

    expect(
      await screen.findByRole('heading', { level: 1, name: es.payments.page.title }),
    ).toBeVisible();
    await monthLoaded();
    expect(screen.getByText(formatMonth(currentMonth()))).toBeVisible();
    expect(incomeSection()).toHaveTextContent(
      es.payments.page.income.none.replace('{{month}}', formatMonth(currentMonth())),
    );
    expect(pendingSection()).toHaveTextContent(es.payments.page.pending.none);
    expect(
      screen.queryByRole('button', { name: es.payments.page.export.button }),
    ).not.toBeInTheDocument();
  });

  it("shows the month's income per currency, without deleted or other months' payments", async () => {
    await seed();
    await openPayments();

    const income = within(incomeSection()).getAllByRole('listitem');
    expect(income.map((item) => item.textContent)).toEqual([
      formatMoney(1_500_000, 'CRC'),
      formatMoney(1_000, 'USD'),
    ]);
  });

  it('lists sessions still owed, oldest first, across all months', async () => {
    const { ana, bea } = await seed();
    await openPayments();

    const list = within(pendingSection()).getByRole('list', {
      name: es.payments.page.pending.list,
    });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Ana Prueba');
    expect(links[0]?.textContent).toContain(`Falta ${formatMoney(1_500_000, 'CRC')}`);
    expect(links[0]).toHaveAttribute('href', `/sessions/${ana.id}`);
    expect(links[1]).toHaveTextContent('Bea Prueba');
    expect(links[1]?.textContent).toContain(`Falta ${formatMoney(4_000, 'USD')}`);
    expect(links[1]).toHaveAttribute('href', `/sessions/${bea.id}`);
  });

  it("lists the month's payments newest first, linking to their session", async () => {
    const { carla } = await seed();
    await openPayments();

    const rows = paymentRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('PayPal');
    expect(rows[1]).toContain('Carla Prueba');
    expect(rows[1]).toContain(formatMoney(1_500_000, 'CRC'));
    expect(rows[1]).toContain('Ref. 998877');
    const links = within(listSection()).getAllByRole('link');
    expect(links[1]).toHaveAttribute('href', `/sessions/${carla.id}`);
  });

  it('filters the list by method and client, keeping the filters in the URL', async () => {
    const { carla } = await seed();
    const user = userEvent.setup();
    const router = await openPayments();
    const list = listSection();

    await user.selectOptions(
      within(list).getByLabelText(es.payments.page.filter.method),
      es.payments.method.paypal,
    );
    expect(paymentRows()).toHaveLength(1);
    expect(paymentRows()[0]).toContain('PayPal');
    expect(router.state.location.search).toContain('method=paypal');

    await user.selectOptions(
      within(list).getByLabelText(es.payments.page.filter.method),
      es.payments.method.cash,
    );
    expect(within(list).getByText(es.payments.page.list.noMatch)).toBeVisible();
    await user.click(
      within(list).getByRole('button', { name: es.payments.page.list.clearFilters }),
    );
    expect(paymentRows()).toHaveLength(2);
    expect(router.state.location.search).toBe('?month=2026-10');

    const clientPicker = within(list).getByLabelText(es.payments.page.filter.client);
    // Only clients with a payment this month: Ana paid in September, Bea hasn't paid.
    expect(
      within(clientPicker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([es.payments.page.filter.all, 'Carla Prueba']);
    await user.selectOptions(clientPicker, 'Carla Prueba');
    expect(paymentRows()).toHaveLength(2);
    expect(router.state.location.search).toContain(`client=${carla.client_id}`);
  });

  it('moves between months', async () => {
    await seed();
    const user = userEvent.setup();
    const router = await openPayments();

    await user.click(screen.getByRole('button', { name: es.payments.page.month.previous }));

    await monthLoaded('septiembre de 2026');
    expect(router.state.location.search).toBe('?month=2026-09');
    expect(
      within(incomeSection())
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([formatMoney(500_000, 'CRC')]);
    expect(paymentRows('septiembre de 2026')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: es.payments.page.month.next }));
    await user.click(screen.getByRole('button', { name: es.payments.page.month.next }));
    await monthLoaded('noviembre de 2026');
    expect(paymentRows('noviembre de 2026')).toHaveLength(1);
  });

  it('falls back to the current month for a bad month in the URL', async () => {
    await openPayments('?month=2026-13');
    expect(screen.getByText(formatMonth(currentMonth()))).toBeVisible();
  });

  describe('CSV export', () => {
    const restores: (() => void)[] = [];
    const stub = (target: object, name: string, value: unknown) => {
      restores.push(stubProperty(target, name, value));
    };
    let click: MockInstance<HTMLAnchorElement['click']>;
    let downloaded: Blob | undefined;

    beforeEach(() => {
      downloaded = undefined;
      stub(
        URL,
        'createObjectURL',
        vi.fn((blob: Blob) => {
          downloaded = blob;
          return 'blob:payments';
        }),
      );
      stub(URL, 'revokeObjectURL', vi.fn());
      click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      click.mockRestore();
      while (restores.length > 0) restores.pop()?.();
    });

    const expectedRows = [
      'Fecha;Cliente;Monto;Moneda;Método;Referencia;Nota',
      '2026-10-10;Carla Prueba;15000,00;CRC;SINPE Móvil;998877;',
      '2026-10-12;Carla Prueba;10,00;USD;PayPal;;Propina',
      '',
    ];

    /** The file's bytes: a UTF-8 BOM, then the rows (CRLF). */
    async function expectCsv(file: Blob | undefined) {
      const bytes = new Uint8Array((await file?.arrayBuffer()) ?? new ArrayBuffer(0));
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(bytes).split('\r\n')).toEqual(expectedRows);
    }

    it("downloads every payment of the month, ignoring the list's filters", async () => {
      await seed();
      const user = userEvent.setup();
      await openPayments('?month=2026-10&method=paypal');

      await user.click(screen.getByRole('button', { name: es.payments.page.export.button }));

      await waitFor(() => {
        expect(click).toHaveBeenCalledOnce();
      });
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe('pagos-2026-10.csv');
      expect(link.href).toBe('blob:payments');
      expect(downloaded?.type).toBe('text/csv');
      await expectCsv(downloaded);
    });

    it('shares the file instead where the browser can (iOS web app)', async () => {
      await seed();
      const user = userEvent.setup();
      const share = vi.fn<(data: { files: File[] }) => Promise<void>>(() => Promise.resolve());
      stub(navigator, 'canShare', (data: { files?: File[] }) => data.files?.length === 1);
      stub(navigator, 'share', share);
      await openPayments('?month=2026-10&method=paypal');

      await user.click(screen.getByRole('button', { name: es.payments.page.export.button }));

      await waitFor(() => {
        expect(share).toHaveBeenCalledOnce();
      });
      const file = share.mock.calls[0]?.[0].files[0];
      expect(file?.name).toBe('pagos-2026-10.csv');
      expect(file?.type).toBe('text/csv');
      await expectCsv(file);
      expect(click).not.toHaveBeenCalled();
    });
  });
});

describe('Pagos screen in Costa Rica time', () => {
  useTimeZone('America/Costa_Rica');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('files a payment recorded at 23:30 on the last day of the month in that month', async () => {
    // 31 Oct 2026 at 23:30 in Costa Rica (UTC−6) is already 1 Nov in UTC. Only Date is faked,
    // so IndexedDB and Testing Library timers still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T05:30:00Z'));
    const user = userEvent.setup();
    const session = await sessionFor('Dora Prueba', {
      started_at: new Date().toISOString(),
      price_minor: 1_500_000,
    });

    // Record it with the form's defaults, as she would right after the reading.
    const router = renderAt(`/sessions/${session.id}`);
    await user.click(await screen.findByRole('button', { name: es.payments.section.add }));
    const add = screen.getByRole('form', { name: es.payments.form.addTitle });
    await user.click(within(add).getByRole('button', { name: es.common.save }));
    await waitFor(async () => {
      expect((await repos.payment.list()).map((p) => p.paid_at)).toEqual(['2026-10-31']);
    });

    await router.navigate('/payments');
    await monthLoaded('octubre de 2026');
    expect(
      within(incomeSection())
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([formatMoney(1_500_000, 'CRC')]);
    expect(paymentRows()).toHaveLength(1);
    expect(paymentRows()[0]).toContain('Dora Prueba');

    await user.click(screen.getByRole('button', { name: es.payments.page.month.next }));
    await monthLoaded('noviembre de 2026');
    expect(incomeSection()).toHaveTextContent('No hay pagos registrados en noviembre de 2026.');
  });
});
