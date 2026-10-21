// T1.15 main path on an iPhone (WebKit): client → session → Cruz Celta → payment → offline
// reload, and everything is still there, on screen and in IndexedDB.

import { FAKE_CLIENT, SESSION_NOTE } from './fixtures.ts';
import {
  addPayment,
  celticCross,
  celticCrossCards,
  createClient,
  expectCelticCrossPlaced,
  incomeItems,
  openClients,
  readCelticCross,
  REVERSED_POSITION,
  setPrice,
  startSession,
} from './flows.ts';
import {
  es,
  expect,
  expectNoApiRequests,
  formatted,
  readRows,
  test,
  tr,
  waitForServiceWorker,
} from './support.ts';

const summary = (paid: string, price: string, remaining: string) =>
  formatted(
    `${tr(es.payments.summary.paidOfPrice, { paid, price })} ${tr(es.payments.summary.remaining, {
      amount: remaining,
    })}`,
  );

async function expectStoredData(page: Parameters<typeof readRows>[0]) {
  const [clients, sessions, readings, draws, payments] = await Promise.all([
    readRows(page, 'client'),
    readRows(page, 'session'),
    readRows(page, 'reading'),
    readRows(page, 'card_draw'),
    readRows(page, 'payment'),
  ]);
  expect(clients).toEqual([
    expect.objectContaining({
      name: FAKE_CLIENT.name,
      birth_date: FAKE_CLIENT.birthDate,
      birth_time: null,
      birth_place_label: FAKE_CLIENT.city,
      birth_tz: 'America/Costa_Rica',
    }),
  ]);
  expect(sessions).toEqual([
    expect.objectContaining({ price_minor: 1_500_000, currency: 'CRC', notes: SESSION_NOTE }),
  ]);
  expect(readings).toHaveLength(1);
  expect(
    draws
      .map((draw) => [draw.position_index, draw.card_id, draw.reversed])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  ).toEqual(
    celticCross.positions.map((position) => [
      position.index,
      `major-${String(position.index - 1).padStart(2, '0')}`,
      position.index === REVERSED_POSITION,
    ]),
  );
  expect(payments).toEqual([
    expect.objectContaining({ amount_minor: 1_000_000, currency: 'CRC', method: 'sinpe' }),
  ]);
}

test('a client, session, Cruz Celta and payment survive an offline reload', async ({
  page,
  context,
  api,
}) => {
  expect(celticCrossCards).toHaveLength(10);
  await page.goto('/');
  await waitForServiceWorker(page);

  await openClients(page);
  await createClient(page, FAKE_CLIENT);
  await startSession(page, FAKE_CLIENT.name);
  await setPrice(page, '15000', 'CRC', '₡15 000');
  await page.getByLabel(es.sessions.field.notes).fill(SESSION_NOTE);
  await page.getByLabel(es.sessions.field.notes).blur();
  await expect(page.getByText(es.sessions.save.saved, { exact: true })).toBeVisible();

  await readCelticCross(page);
  await page.getByRole('link', { name: es.common.back }).click();
  const readingLink = page.getByRole('link', { name: new RegExp(celticCross.name) });
  await expect(readingLink).toContainText(
    tr(es.sessions.readings.placed, { placed: 10, total: 10 }),
  );

  await addPayment(page, '10000', 'sinpe');
  await expect(page.getByText(es.payments.status.partial, { exact: true })).toBeVisible();
  await expect(page.getByText(summary('₡10 000', '₡15 000', '₡5 000'))).toBeVisible();
  await expectStoredData(page);

  // Offline from here on: only the service worker's precache can serve the app.
  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: tr(es.sessions.title, { name: FAKE_CLIENT.name }),
    }),
  ).toBeVisible();
  await expect(page.getByLabel(es.sessions.field.notes)).toHaveValue(SESSION_NOTE);
  await expect(
    page.getByText(formatted(tr(es.sessions.field.pricePreview, { amount: '₡15 000' }))),
  ).toBeVisible();
  await expect(page.getByText(es.payments.status.partial, { exact: true })).toBeVisible();
  await expect(page.getByText(summary('₡10 000', '₡15 000', '₡5 000'))).toBeVisible();
  await expect(readingLink).toContainText(
    tr(es.sessions.readings.placed, { placed: 10, total: 10 }),
  );

  await readingLink.click();
  await expectCelticCrossPlaced(page);

  // A cold load of other pages while offline.
  await page.goto('/clients');
  await expect(page.getByRole('link', { name: new RegExp(FAKE_CLIENT.name) })).toBeVisible();
  await page.goto('/payments');
  await expect(page.getByRole('heading', { level: 1, name: es.payments.page.title })).toBeVisible();
  await expect(incomeItems(page)).toHaveText([formatted('₡10 000', { whole: true })]);
  await expect(
    page.getByText(formatted(tr(es.payments.page.pending.owes, { amount: '₡5 000' }))),
  ).toBeVisible();

  await expectStoredData(page);
  await expectNoApiRequests(page, api);
});
