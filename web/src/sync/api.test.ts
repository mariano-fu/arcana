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
    [404, { kind: 'server_error', status: 404 }],
    [429, { kind: 'throttled' }],
    [502, { kind: 'server_error', status: 502 }],
  ])('maps HTTP %i', async (status, expected) => {
    const result = await createApi(fakeFetch(status, { records: [] })).sync('t', request);

    expect(result).toEqual(expected);
  });

  it.each([
    [200, '<!doctype html><html></html>'],
    [400, '<!doctype html><html></html>'],
    [401, '<!doctype html><html></html>'],
    [404, '<!doctype html><html></html>'],
    [200, ''],
    [200, '"just a string"'],
  ])('maps HTTP %i with a non-JSON-object body to server_error', async (status, body) => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(body, { status })));

    expect(await createApi(fetchFn).sync('t', request)).toEqual({ kind: 'server_error', status });
  });

  it('maps a failed fetch to network', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await createApi(fetchFn).sync('t', request)).toEqual({ kind: 'network' });
  });
});

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** No answer at all until the request is aborted, as with Tailscale half-up. */
function hangingFetch() {
  return vi.fn<FetchFn>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(abortError());
        });
      }),
  );
}

/** Headers arrive, then the body stalls until the request is aborted. */
function stallingBodyFetch() {
  return vi.fn<FetchFn>((_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          controller.error(abortError());
        });
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  });
}

describe('request timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a sync after 30 s with no answer: network, so the run ends offline', async () => {
    const fetchFn = hangingFetch();
    let result: unknown;
    void createApi(fetchFn)
      .sync('t', request)
      .then((value) => (result = value));

    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toEqual({ kind: 'network' });
    expect(fetchFn.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['login', (api: ReturnType<typeof createApi>) => api.login({ username: 'u', password: 'p' })],
    ['refresh', (api: ReturnType<typeof createApi>) => api.refresh('refresh-1')],
  ])('gives up on %s after 15 s', async (_, call) => {
    let result: unknown;
    void call(createApi(hangingFetch())).then((value) => (result = value));

    await vi.advanceTimersByTimeAsync(14_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toEqual({ kind: 'network' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a body that stalls past the timeout as network, not a server error', async () => {
    const pending = createApi(stallingBodyFetch()).sync('t', request);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await pending).toEqual({ kind: 'network' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['a success', () => Promise.resolve(new Response('{"cursor":4}', { status: 200 })), 'ok'],
    [
      'an HTTP error',
      () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
      'server_error',
    ],
    [
      'a rejected 400',
      () => Promise.resolve(new Response('{"records":[]}', { status: 400 })),
      'rejected',
    ],
    ['a throw', () => Promise.reject(new TypeError('Failed to fetch')), 'network'],
  ])('clears its timer after %s', async (_, respond, kind) => {
    const result = await createApi(vi.fn<FetchFn>(respond)).sync('t', request);

    expect(result.kind).toBe(kind);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes custom timeouts', async () => {
    let result: unknown;
    void createApi(hangingFetch(), '', { syncMs: 50, authMs: 10 })
      .sync('t', request)
      .then((value) => (result = value));

    await vi.advanceTimersByTimeAsync(50);

    expect(result).toEqual({ kind: 'network' });
  });
});
