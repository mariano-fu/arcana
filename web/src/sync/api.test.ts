import { createApi } from './api';

function fakeFetch(status: number, body: unknown = {}) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

const request = { device_id: '0190a000-0000-7000-8000-00000000000a', cursor: 3, changes: [] };

describe('createApi', () => {
  it('posts JSON with the bearer token to /api/sync/', async () => {
    const fetchFn = fakeFetch(200, { cursor: 4 });

    const result = await createApi(fetchFn).sync('token-a', request);

    expect(result).toEqual({ kind: 'ok', body: { cursor: 4 } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/sync/');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-a',
    });
    expect(init?.body).toBe(JSON.stringify(request));
  });

  it('sends no Authorization header to the token endpoints', async () => {
    const fetchFn = fakeFetch(200, { access: 'a', refresh: 'r' });

    await createApi(fetchFn).refresh('refresh-1');

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/token/refresh/');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe('{"refresh":"refresh-1"}');
  });

  it.each([
    [400, { kind: 'rejected', body: { records: [] } }],
    [401, { kind: 'unauthorized' }],
    [429, { kind: 'throttled' }],
    [502, { kind: 'server_error', status: 502 }],
  ])('maps HTTP %i', async (status, expected) => {
    const result = await createApi(fakeFetch(status, { records: [] })).sync('t', request);

    expect(result).toEqual(expected);
  });

  it('maps a failed fetch to network', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await createApi(fetchFn).sync('t', request)).toEqual({ kind: 'network' });
  });
});
