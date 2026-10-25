// T3.9: two phones edit offline, then sync through the real API, A → B → A. B's later note wins
// and A's text is kept as a conflict; B's delete of a ficha beats A's untouched payment, while
// the payment A added offline stays live under the deleted ficha and still shows in Pagos and
// its CSV as "(cliente eliminado)".
//
// Needs the API: the CI `e2e` job starts it (playwright.config.ts) and sets E2E_API and the
// made-up account's credentials. Without E2E_API, playwright.config.ts leaves this spec out.

import { test } from '@playwright/test';

import { goOffline, goOnline, logIn, openDevice, syncNow, type Device } from './devices.ts';
import { syncFixtures } from './fixtures.ts';
import { addPayment, createClient, openClients, setPrice, startSession } from './flows.ts';
import { es, expect, formatted, readRows, readStore, tr } from './support.ts';

const credentials = {
  username: process.env.E2E_API_USERNAME ?? '',
  password: process.env.E2E_API_PASSWORD ?? '',
};

const sessionIdFrom = (page: Device['page']) => {
  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw new Error(`not on a session page: ${page.url()}`);
  return id;
};

async function writeNotes({ page }: Device, sessionId: string, text: string): Promise<void> {
  await page.goto(`/sessions/${sessionId}`);
  const notes = page.getByLabel(es.sessions.field.notes);
  await notes.fill(text);
  await notes.blur();
  await expect(page.getByText(es.sessions.save.saved, { exact: true })).toBeVisible();
}

async function sessionRow({ page }: Device, id: string): Promise<Record<string, unknown>> {
  const row = (await readStore(page, 'session')).find((r) => r.id === id);
  if (!row) throw new Error(`session ${id} missing on this device`);
  return row;
}

async function capturePaymentsCsv({ page }: Device): Promise<string> {
  // Pretend the browser can share files (iOS) and keep the file's text instead of opening the
  // share sheet: a real download or share sheet isn't reliable in headless WebKit.
  await page.evaluate(() => {
    const target = window as unknown as { e2eSharedCsv?: string };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }: { files: File[] }) => {
        target.e2eSharedCsv = await files[0]?.text();
      },
    });
  });
  await page.getByRole('button', { name: es.payments.page.export.button }).click();
  let csv = '';
  await expect
    .poll(async () => {
      csv = await page.evaluate(
        () => (window as unknown as { e2eSharedCsv?: string }).e2eSharedCsv ?? '',
      );
      return csv.length > 0;
    })
    .toBe(true);
  return csv;
}

test('two devices edit offline, sync, and agree on the outcome', async ({ browser }, info) => {
  test.setTimeout(180_000);
  expect(credentials.username, 'E2E_API_USERNAME').not.toBe('');
  expect(credentials.password, 'E2E_API_PASSWORD').not.toBe('');
  const f = syncFixtures(`${String(Date.now())}-${String(info.retry)}`);

  const a = await openDevice(browser, info, 'A');
  const b = await openDevice(browser, info, 'B');

  // A: one ficha whose session notes both devices will edit, and one with a priced session and
  // a payment, which B will delete. Synced, then B logs in and pulls it all.
  await logIn(a, credentials);
  await a.page.goto('/');
  await openClients(a.page);
  await createClient(a.page, f.notesClient);
  await startSession(a.page, f.notesClient.name);
  const notesSession = sessionIdFrom(a.page);
  await openClients(a.page);
  await createClient(a.page, f.deletedClient);
  await startSession(a.page, f.deletedClient.name);
  const deletedSession = sessionIdFrom(a.page);
  await setPrice(a.page, '20000', 'CRC', '₡20 000');
  await addPayment(a.page, '5000', 'cash', { reference: f.firstPaymentRef });
  await syncNow(a);

  await logIn(b, credentials);
  const pulled = (await readRows(b.page, 'client')).map((c) => c.name);
  expect(pulled).toEqual(expect.arrayContaining([f.notesClient.name, f.deletedClient.name]));

  // Both offline. A edits first, then B, so B's note is the later one.
  await goOffline(a);
  await goOffline(b);

  await writeNotes(a, notesSession, f.noteA);
  await a.page.goto(`/sessions/${deletedSession}`);
  await addPayment(a.page, '10000', 'sinpe', { reference: f.lateralPaymentRef });

  await writeNotes(b, notesSession, f.noteB);
  await openClients(b.page);
  await b.page.getByRole('link', { name: new RegExp(f.deletedClient.name) }).click();
  await expect(b.page.getByRole('heading', { level: 1, name: f.deletedClient.name })).toBeVisible();
  await b.page.getByRole('button', { name: es.clients.detail.delete, exact: true }).click();
  await b.page
    .getByRole('alertdialog', { name: tr(es.clients.delete.title, { name: f.deletedClient.name }) })
    .getByRole('button', { name: es.clients.delete.confirm })
    .click();
  await expect(b.page.getByRole('heading', { level: 1, name: es.clients.title })).toBeVisible();

  // Nothing reached the server, and last-write-wins will pick B's note.
  const rowA = await sessionRow(a, notesSession);
  const rowB = await sessionRow(b, notesSession);
  expect([rowA.notes, rowA.pending]).toEqual([f.noteA, 1]);
  expect([rowB.notes, rowB.pending]).toEqual([f.noteB, 1]);
  expect(String(rowB.updated_at) > String(rowA.updated_at), 'B edited after A').toBe(true);

  await goOnline(a);
  await syncNow(a);
  await goOnline(b);
  await syncNow(b);
  await syncNow(a);

  for (const device of [a, b]) {
    await test.step(`device ${device.name} has the merged result`, async () => {
      const { page } = device;

      // Concurrent notes: B's text is current, A's is kept as a conflict to review.
      await page.goto(`/sessions/${notesSession}`);
      await expect(page.getByLabel(es.sessions.field.notes)).toHaveValue(f.noteB);
      await page.goto('/');
      const review = page.getByRole('region', { name: es.conflicts.inicio.title });
      await review.getByRole('link', { name: es.conflicts.inicio.action }).click();
      await expect(page.getByRole('heading', { level: 1, name: es.conflicts.title })).toBeVisible();
      const conflict = page.getByRole('region', { name: new RegExp(f.notesClient.name) });
      await expect(conflict.getByText(f.noteB, { exact: true })).toBeVisible();
      await expect(conflict.getByText(f.noteA, { exact: true })).toBeVisible();

      // Delete vs. edit: the ficha, its session and the payment B knew about are gone; the
      // payment A added offline stays live under them.
      const clients = (await readRows(page, 'client')).map((c) => c.name);
      expect(clients).toContain(f.notesClient.name);
      expect(clients).not.toContain(f.deletedClient.name);
      expect((await readRows(page, 'session')).map((s) => s.id)).not.toContain(deletedSession);
      const payments = (await readRows(page, 'payment')).filter(
        (p) => p.session_id === deletedSession,
      );
      expect(payments.map((p) => [p.reference, p.amount_minor])).toEqual([
        [f.lateralPaymentRef, 1_000_000],
      ]);

      // Pagos lists it this month, the ficha shown as deleted; the CSV has it too.
      await page.goto('/payments');
      const list = page.getByRole('list', { name: es.payments.page.list.label });
      const row = list
        .getByRole('listitem')
        .filter({ hasText: tr(es.payments.item.reference, { reference: f.lateralPaymentRef }) });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(es.payments.page.csv.unknownClient);
      await expect(row).toContainText(formatted('₡10 000'));
      await expect(list.getByText(f.firstPaymentRef)).toHaveCount(0);

      const lines = (await capturePaymentsCsv(device)).split('\r\n');
      expect(lines.filter((line) => line.includes(f.lateralPaymentRef))).toEqual([
        expect.stringMatching(
          new RegExp(
            `^\\d{4}-\\d{2}-\\d{2};\\(cliente eliminado\\);10000,00;CRC;SINPE Móvil;${f.lateralPaymentRef};$`,
          ),
        ),
      ]);
      expect(lines.some((line) => line.includes(f.firstPaymentRef))).toBe(false);
    });
  }

  await a.context.close();
  await b.context.close();
});
