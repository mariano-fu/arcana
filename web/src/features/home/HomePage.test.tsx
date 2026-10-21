import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos, type NewRow, type Session } from '../../db';
import es from '../../i18n/locales/es.json';
import { useTimeZone } from '../../test/time-zone';
import { deleteClient } from '../clients/deletion';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';
import { formatMoney } from '../payments';

const H = es.home;

function renderAt(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function sessionFor(
  name: string,
  overrides: Partial<NewRow<Session>> = {},
  archived = false,
): Promise<Session> {
  const client =
    (await repos.client.list()).find((c) => c.name === name) ??
    (await repos.client.create(newClient({ name, archived })));
  return repos.session.create(newSession(client.id, overrides));
}

/** Amounts use no-break spaces; compare text with all whitespace folded. */
const fold = (text: string | null) => (text ?? '').replace(/\s+/g, ' ');

const section = async (title: string) => within(await screen.findByRole('region', { name: title }));

beforeEach(async () => {
  await clearDb();
});

describe('Inicio in Costa Rica time', () => {
  useTimeZone('America/Costa_Rica');

  beforeEach(() => {
    // 23:30 on 31 Oct in Costa Rica is already 1 Nov in UTC. Only Date is faked, so
    // IndexedDB and Testing Library timers still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T05:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels follow-ups by the local date: yesterday, today and tomorrow', async () => {
    await sessionFor('Ana Prueba', { follow_up_date: '2026-10-31', follow_up_note: 'Llamar' });
    await sessionFor('Bea Prueba', { follow_up_date: '2026-11-01' });
    await sessionFor('Caro Prueba', { follow_up_date: '2026-10-30' });
    renderAt();

    const followUps = await section(H.followUps.title);
    const rows = await followUps.findAllByRole('link');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Caro PruebaAtrasado · hace 1 día',
      'Ana PruebaHoyLlamar',
      'Bea PruebaMañana',
    ]);
  });

  it('shows at most 10 follow-ups and says how many more there are', async () => {
    for (let i = 0; i < 12; i++) {
      await sessionFor(`Cliente ${String(i).padStart(2, '0')}`, { follow_up_date: '2026-11-05' });
    }
    renderAt();
    const followUps = await section(H.followUps.title);
    expect(await followUps.findAllByRole('link')).toHaveLength(10);
    expect(followUps.getByText('y 2 más')).toBeVisible();
  });

  it("hides an archived client's follow-up but keeps the balance", async () => {
    await sessionFor('Arch Prueba', { follow_up_date: '2026-11-03', price_minor: 1_000_000 }, true);
    renderAt();
    const balances = await section(H.balances.title);
    expect(await balances.findByRole('link', { name: /Arch Prueba/ })).toBeVisible();
    expect((await section(H.followUps.title)).getByText(H.followUps.empty)).toBeVisible();
  });
});

describe('Inicio', () => {
  it('shows each empty state', async () => {
    renderAt();
    expect((await section(H.followUps.title)).getByText(H.followUps.empty)).toBeVisible();
    expect((await section(H.balances.title)).getByText(H.balances.empty)).toBeVisible();
    const recent = await section(H.recent.title);
    expect(recent.getByText(H.recent.empty)).toBeVisible();
    expect(recent.getByRole('link', { name: H.recent.start })).toHaveAttribute('href', '/clients');
  });

  it('totals balances per currency, oldest first, and links to Pagos past 5', async () => {
    const crc = await sessionFor('Ana Prueba', {
      started_at: '2026-09-01T15:00:00.000Z',
      price_minor: 2_000_000,
    });
    await repos.payment.create(newPayment(crc, { amount_minor: 500_000 }));
    await sessionFor('Bea Prueba', {
      started_at: '2026-09-02T15:00:00.000Z',
      price_minor: 4_000,
      currency: 'USD',
    });
    for (let i = 3; i <= 7; i++) {
      await sessionFor(`Cliente ${String(i)}`, {
        started_at: `2026-09-0${String(i)}T15:00:00.000Z`,
        price_minor: 1_000_000,
      });
    }
    // Paid and free sessions owe nothing.
    const paid = await sessionFor('Paga Prueba', { price_minor: 1_000_000 });
    await repos.payment.create(newPayment(paid, { amount_minor: 1_000_000 }));
    await sessionFor('Gratis Prueba');
    renderAt();

    const balances = await section(H.balances.title);
    const total = (await balances.findByText(`${H.balances.total}:`)).parentElement;
    expect(fold(total?.textContent ?? null)).toBe(
      fold(`${H.balances.total}: ${formatMoney(6_500_000, 'CRC')} · ${formatMoney(4_000, 'USD')}`),
    );
    const rows = balances.getAllByRole('link', { name: /Prueba|Cliente/ });
    const names = ['Ana Prueba', 'Bea Prueba', 'Cliente 3', 'Cliente 4', 'Cliente 5'];
    expect(rows).toHaveLength(names.length);
    rows.forEach((row, i) => {
      expect(row).toHaveTextContent(names[i] ?? '');
    });
    expect(fold(rows[0]?.textContent ?? null)).toContain(fold(formatMoney(1_500_000, 'CRC')));
    expect(fold(rows[1]?.textContent ?? null)).toContain(fold(formatMoney(4_000, 'USD')));
    expect(balances.getByRole('link', { name: 'Ver todos en Pagos (7)' })).toHaveAttribute(
      'href',
      '/payments',
    );
  });

  it('lists the 5 newest sessions with their status and opens one', async () => {
    const user = userEvent.setup();
    for (let i = 1; i <= 6; i++) {
      await sessionFor(`Cliente ${String(i)}`, {
        started_at: `2026-10-0${String(i)}T15:00:00.000Z`,
        price_minor: i === 6 ? 1_000_000 : null,
      });
    }
    const router = renderAt();
    const recent = await section(H.recent.title);
    const rows = await recent.findAllByRole('link');
    expect(rows.map((row) => row.textContent.slice(0, 9))).toEqual([
      'Cliente 6',
      'Cliente 5',
      'Cliente 4',
      'Cliente 3',
      'Cliente 2',
    ]);
    expect(rows[0]).toHaveTextContent(es.payments.status.pending);
    expect(rows[1]).toHaveTextContent(es.payments.status.no_charge);

    await user.click(rows[0] as HTMLElement);
    const [newest] = (await repos.session.list()).filter(
      (s) => s.started_at === '2026-10-06T15:00:00.000Z',
    );
    expect(router.state.location.pathname).toBe(`/sessions/${String(newest?.id)}`);
  });

  it('leaves out deleted clients and sessions', async () => {
    const gone = await sessionFor('Ida Prueba', { price_minor: 1_000_000 });
    const removed = await sessionFor('Eva Prueba', { price_minor: 1_000_000 });
    await deleteClient(db, gone.client_id);
    await repos.session.remove(removed.id);
    renderAt();
    expect((await section(H.recent.title)).getByText(H.recent.empty)).toBeVisible();
    expect((await section(H.balances.title)).getByText(H.balances.empty)).toBeVisible();
  });
});
