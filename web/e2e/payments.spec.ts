// Money on an iPhone (WebKit): amounts typed es-CR style are stored as integer minor units and
// shown formatted; the payments page totals each currency apart, never summed together.

import { FAKE_CLIENT, OTHER_FAKE_CLIENT } from './fixtures.ts';
import {
  addPayment,
  createClient,
  incomeItems,
  openClients,
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
  waitForServiceWorker,
} from './support.ts';

test('amounts are stored in minor units and shown formatted, per currency', async ({
  page,
  api,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  // Dollars, with a decimal comma: 40,5 → US$40,50, stored as 4050 cents; it overpays US$40.
  await openClients(page);
  await createClient(page, { name: FAKE_CLIENT.name });
  await startSession(page, FAKE_CLIENT.name);
  await setPrice(page, '40', 'USD', 'US$40,00');
  await addPayment(page, '40,5', 'paypal');
  await expect(page.getByText(es.payments.status.overpaid, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('list', { name: es.payments.section.list }).getByText(formatted('US$40,50')),
  ).toBeVisible();

  // Colones, typed with grouping: 15 000 → ₡15 000, stored as 1 500 000 céntimos; paid in full.
  await openClients(page);
  await createClient(page, { name: OTHER_FAKE_CLIENT.name });
  await startSession(page, OTHER_FAKE_CLIENT.name);
  await setPrice(page, '15000', 'CRC', '₡15 000');
  await addPayment(page, '15 000', 'cash');
  await expect(page.getByText(es.payments.status.paid, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: es.payments.section.list }).getByText(formatted('₡15 000')),
  ).toBeVisible();

  const sessions = await readRows(page, 'session');
  expect(sessions.map((s) => [s.price_minor, s.currency]).sort()).toEqual([
    [1_500_000, 'CRC'],
    [4_000, 'USD'],
  ]);
  const payments = await readRows(page, 'payment');
  expect(payments.map((p) => [p.amount_minor, p.currency, p.method]).sort()).toEqual([
    [1_500_000, 'CRC', 'cash'],
    [4_050, 'USD', 'paypal'],
  ]);
  for (const payment of payments) expect(Number.isInteger(payment.amount_minor)).toBe(true);

  await page
    .getByRole('navigation', { name: es.nav.label })
    .getByRole('link', { name: es.nav.payments })
    .click();
  await expect(incomeItems(page)).toHaveText([
    formatted('₡15 000', { whole: true }),
    formatted('US$40,50', { whole: true }),
  ]);

  await expectNoApiRequests(page, api);
});
