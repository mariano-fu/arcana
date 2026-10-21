// Shared e2e helpers: the /api guard, the service-worker wait, raw IndexedDB reads and the
// Spanish strings (read from es.json, so copy changes don't break the tests).

import { readFileSync } from 'node:fs';

import { test as base, expect, type Page } from '@playwright/test';

type Es = typeof import('../src/i18n/locales/es.json');
type Spreads = typeof import('../src/seed/spreads.json');
type Cards = typeof import('../src/seed/cards.es.json');

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

export const es = readJson('../src/i18n/locales/es.json') as Es;
export const spreadsSeed = readJson('../src/seed/spreads.json') as Spreads;
export const cardsSeed = readJson('../src/seed/cards.es.json') as Cards;

/** Fills `{{name}}` placeholders like i18next. */
export function tr(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

/**
 * A regex for formatted text: any space in `text` also matches the no-break spaces Intl puts in
 * amounts ("₡15 000"), and the rest is matched literally. `whole` anchors it to the full text.
 */
export function formatted(text: string, { whole = false } = {}): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/ /g, '[\\s\\u00a0\\u202f]');
  return new RegExp(whole ? `^${pattern}$` : pattern);
}

/** Every request to /api, recorded two ways (see `test`). */
export interface ApiGuard {
  /** Requests the browser context saw; each one was aborted. */
  routed: string[];
}

const API_LOG_KEY = 'e2e:api-requests';

/**
 * Signed out, the sync engine must send nothing (T3.6). Each test gets:
 * - `context.route('**\/api/**')`, which records and aborts any request it sees;
 * - a `fetch` wrapper installed before the app's scripts, which logs each /api call to
 *   sessionStorage (it survives reloads) and fails it like a network error. It is needed because
 *   in WebKit the context route does not see requests from a page the service worker controls:
 *   they would reach the preview server.
 * Tests call `expectNoApiRequests` at the end.
 */
export const test = base.extend<{ api: ApiGuard }>({
  api: async ({ context }, use) => {
    const guard: ApiGuard = { routed: [] };
    await context.route('**/api/**', (route) => {
      guard.routed.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    });
    await context.addInitScript((key) => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, window.location.href).pathname.startsWith('/api/')) {
          const log = JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
          log.push(url);
          sessionStorage.setItem(key, JSON.stringify(log));
          return Promise.reject(new TypeError('e2e: /api requests are blocked'));
        }
        return original(input, init);
      };
    }, API_LOG_KEY);
    await use(guard);
  },
});

export { expect };

/** Asserts that neither the route guard nor the page's fetch saw an /api request. */
export async function expectNoApiRequests(page: Page, api: ApiGuard): Promise<void> {
  const fetched = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[],
    API_LOG_KEY,
  );
  expect(api.routed, 'requests to /api routed by the browser').toEqual([]);
  expect(fetched, 'fetch calls to /api made by the page').toEqual([]);
}

/** Waits until the service worker controls the page; it activates only once precaching is done. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: 'service worker controls the page',
      timeout: 30_000,
    })
    .toBe(true);
}

/** Live (non-tombstoned) rows of a table, read straight from IndexedDB. */
export async function readRows(page: Page, table: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('arcana');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('indexedDB.open failed'));
      };
    });
    try {
      const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => {
          resolve(request.result as Record<string, unknown>[]);
        };
        request.onerror = () => {
          reject(request.error ?? new Error(`reading ${name} failed`));
        };
      });
      return rows.filter((row) => row.deleted_at === null);
    } finally {
      db.close();
    }
  }, table);
}
