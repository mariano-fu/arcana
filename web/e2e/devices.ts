// Two phones syncing through a real API (T3.9). Only the two-device spec uses these; the other
// specs keep the /api guard in support.ts and never reach a server.

import {
  devices,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { es, expect, readStore, waitForServiceWorker } from './support.ts';

const OFFLINE_KEY = 'e2e:offline';

export interface Device {
  name: string;
  context: BrowserContext;
  page: Page;
}

/**
 * A phone: its own browser context (own IndexedDB, service worker and device_id) with the
 * project's iPhone profile, locale and time zone. Offline means `context.setOffline` plus a fetch
 * gate that fails /api calls, since in WebKit the context's network emulation may not see
 * requests from a page the service worker controls (see the /api guard in support.ts).
 */
export async function openDevice(browser: Browser, info: TestInfo, name: string): Promise<Device> {
  const { baseURL, locale, timezoneId } = info.project.use;
  const context = await browser.newContext({
    ...devices['iPhone 15'],
    baseURL,
    locale,
    timezoneId,
  });
  await context.addInitScript((key) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const api = new URL(url, window.location.href).pathname.startsWith('/api/');
      if (api && sessionStorage.getItem(key) === '1') {
        return Promise.reject(new TypeError('e2e: this device is offline'));
      }
      return original(input, init);
    };
  }, OFFLINE_KEY);
  const page = await context.newPage();
  await page.goto('/');
  await waitForServiceWorker(page);
  return { name, context, page };
}

export async function goOffline({ context, page }: Device): Promise<void> {
  await page.evaluate((key) => {
    sessionStorage.setItem(key, '1');
  }, OFFLINE_KEY);
  await context.setOffline(true);
}

/** Back online; the `online` event may start a sync on its own. */
export async function goOnline({ context, page }: Device): Promise<void> {
  await page.evaluate((key) => {
    sessionStorage.removeItem(key);
  }, OFFLINE_KEY);
  await context.setOffline(false);
}

interface SyncStatus {
  state: string;
  last_success: string | null;
}

async function readSyncStatus(page: Page): Promise<SyncStatus | null> {
  const rows = await readStore(page, 'meta');
  const row = rows.find((r) => r.key === 'sync:status');
  return typeof row?.value === 'string' ? (JSON.parse(row.value) as SyncStatus) : null;
}

async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 2, name: es.settings.sync.title })).toBeVisible();
}

/** Waits for a sync run that succeeded after `since`, whatever started it. */
async function waitForSync(page: Page, since: string | null): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await readSyncStatus(page);
        return (
          status?.state === 'idle' &&
          status.last_success !== null &&
          (since === null || status.last_success > since)
        );
      },
      { message: 'a sync run succeeded', timeout: 30_000 },
    )
    .toBe(true);
}

/** Ajustes → Sincronización → Iniciar sesión; logging in starts a sync, which this waits for. */
export async function logIn(
  { page }: Device,
  credentials: { username: string; password: string },
): Promise<void> {
  await openSettings(page);
  await page.getByRole('button', { name: es.settings.sync.signIn }).click();
  await page.getByLabel(es.settings.sync.username).fill(credentials.username);
  await page.getByLabel(es.settings.sync.password).fill(credentials.password);
  await page.getByRole('button', { name: es.settings.sync.submit }).click();
  await expect(page.getByText(es.settings.sync.signedIn, { exact: true })).toBeVisible();
  await waitForSync(page, null);
}

/** Taps "Sincronizar" and waits until that run (or a later one) succeeded with nothing left. */
export async function syncNow({ page }: Device): Promise<void> {
  await openSettings(page);
  const before = (await readSyncStatus(page))?.last_success ?? null;
  // Disabled while a run started by the page load or the `online` event is going.
  await page.getByRole('button', { name: es.sync.now, exact: true }).click();
  await waitForSync(page, before);
  await expect
    .poll(
      async () => {
        const tables = await Promise.all(
          ['client', 'session', 'payment'].map((table) => readStore(page, table)),
        );
        return tables.flat().filter((row) => row.pending === 1).length;
      },
      { message: 'no pending clients, sessions or payments' },
    )
    .toBe(0);
}
