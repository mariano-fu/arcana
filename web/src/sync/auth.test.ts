import { ArcanaDB } from '../db';
import { createApi } from './api';
import { createAuth } from './auth';
import { createLocalLocks } from './locks';
import { readStatus } from './status';

let db: ArcanaDB;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

const HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

function respond(status: number, body: string) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(body, { status })),
  );
}

function login(fetchFn: (input: string, init: RequestInit) => Promise<Response>) {
  return createAuth(db, createApi(fetchFn), createLocalLocks()).login({
    username: 'lectora',
    password: 'secreta',
  });
}

describe('login', () => {
  it('stores the token pair, and only the tokens', async () => {
    const fetchFn = respond(200, JSON.stringify({ access: 'a1', refresh: 'r1' }));

    expect(await login(fetchFn)).toBe('ok');

    expect(fetchFn.mock.calls[0]?.[0]).toBe('/api/auth/token/');
    expect(await db.auth.toArray()).toEqual([{ key: 'tokens', access: 'a1', refresh: 'r1' }]);
    expect(JSON.stringify(await db.meta.toArray())).not.toContain('secreta');
  });

  it('turns signed_out into idle', async () => {
    await db.meta.put({
      key: 'sync:status',
      value: JSON.stringify({
        state: 'signed_out',
        last_success: null,
        clock_skew_ms: null,
        errors: [],
      }),
    });

    await login(respond(200, JSON.stringify({ access: 'a1', refresh: 'r1' })));

    expect((await readStatus(db)).state).toBe('idle');
  });

  it('is invalid only for a JSON rejection from the API', async () => {
    const detail = JSON.stringify({ detail: 'No active account found with the given credentials' });

    expect(await login(respond(401, detail))).toBe('invalid');
    expect(await db.auth.count()).toBe(0);
  });

  it('is throttled on a 429', async () => {
    expect(await login(respond(429, '{"detail":"Request was throttled."}'))).toBe('throttled');
  });

  it.each([
    ['a 404', 404, '{"detail":"Not found."}'],
    ['an HTML 404', 404, HTML],
    ['an HTML 200 (the app shell, no API deployed)', 200, HTML],
    ['an HTML 401', 401, HTML],
    ['an HTML 400', 400, HTML],
    ['a 502', 502, 'Bad Gateway'],
    ['a 200 that is not a token pair', 200, '{"ok":true}'],
    ['an empty 200', 200, ''],
  ])('is unavailable, never invalid, for %s', async (_, status, body) => {
    expect(await login(respond(status, body))).toBe('unavailable');
    expect(await db.auth.count()).toBe(0);
  });

  it('is unavailable when the network fails', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Load failed')));

    expect(await login(fetchFn)).toBe('unavailable');
  });
});
