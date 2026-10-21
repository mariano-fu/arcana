// Starting cold while offline: after one online visit, a direct link opens from the service
// worker's precache, and a client created offline is still there after another offline reload.

import { OFFLINE_FAKE_CLIENT } from './fixtures.ts';
import {
  es,
  expect,
  expectNoApiRequests,
  readRows,
  test,
  waitForServiceWorker,
} from './support.ts';

test('a direct link works offline and offline edits survive a reload', async ({
  page,
  context,
  api,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.goto('/clients/new');
  await expect(
    page.getByRole('heading', { level: 1, name: es.clients.form.newTitle }),
  ).toBeVisible();
  await page.getByLabel(es.clients.form.name, { exact: true }).fill(OFFLINE_FAKE_CLIENT.name);
  await page.getByRole('button', { name: es.common.save }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: OFFLINE_FAKE_CLIENT.name }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: OFFLINE_FAKE_CLIENT.name }),
  ).toBeVisible();
  await page.goto('/clients');
  await expect(
    page.getByRole('link', { name: new RegExp(OFFLINE_FAKE_CLIENT.name) }),
  ).toBeVisible();
  expect(await readRows(page, 'client')).toEqual([
    expect.objectContaining({ name: OFFLINE_FAKE_CLIENT.name }),
  ]);

  await expectNoApiRequests(page, api);
});
