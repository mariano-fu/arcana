import type { Client, Session } from '../../db';
import { matchesQuery, normalize, sortByLastActivity, withLastVisit } from './list';
import { newClient, newSession } from './test-utils';

const client = (id: string, overrides: Partial<Client> = {}): Client => ({
  ...newClient(),
  id,
  updated_at: '2026-10-01T12:00:00.000Z',
  deleted_at: null,
  server_version: null,
  device_id: 'device',
  pending: 1,
  ...overrides,
});

const session = (id: string, clientId: string, startedAt: string, deleted = false): Session => ({
  ...newSession(clientId, { started_at: startedAt }),
  id,
  updated_at: startedAt,
  deleted_at: deleted ? startedAt : null,
  server_version: null,
  device_id: 'device',
  pending: 1,
});

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('  Martínez Peña ')).toBe('martinez pena');
  });
});

describe('matchesQuery', () => {
  const ana = client('a', { name: 'Ána Solís', instagram: 'luna.ana' });

  it('matches the name ignoring case and accents', () => {
    expect(matchesQuery(ana, 'solis')).toBe(true);
    expect(matchesQuery(ana, 'ANA')).toBe(true);
  });

  it('matches the Instagram handle, with or without @', () => {
    expect(matchesQuery(ana, 'luna')).toBe(true);
    expect(matchesQuery(ana, '@luna.a')).toBe(true);
  });

  it('matches everything for an empty query and nothing unrelated', () => {
    expect(matchesQuery(ana, '  ')).toBe(true);
    expect(matchesQuery(ana, 'pedro')).toBe(false);
    expect(matchesQuery(client('b', { name: 'Pedro' }), 'luna')).toBe(false);
  });
});

describe('withLastVisit', () => {
  it('takes the latest live session per client', () => {
    const items = withLastVisit(
      [client('a'), client('b')],
      [
        session('s1', 'a', '2026-09-01T10:00:00.000Z'),
        session('s2', 'a', '2026-10-05T10:00:00.000Z'),
        session('s3', 'a', '2026-10-09T10:00:00.000Z', true),
      ],
    );
    expect(items.map((item) => item.lastVisit)).toEqual(['2026-10-05T10:00:00.000Z', null]);
  });
});

describe('sortByLastActivity', () => {
  it('sorts by last visit, or created_at for clients without sessions, newest first', () => {
    const sorted = sortByLastActivity([
      { client: client('old', { created_at: '2026-01-01T00:00:00.000Z' }), lastVisit: null },
      { client: client('visited'), lastVisit: '2026-10-05T10:00:00.000Z' },
      { client: client('new', { created_at: '2026-10-18T00:00:00.000Z' }), lastVisit: null },
    ]);
    // A client added today ranks above an older visit; no-visit clients aren't pushed down.
    expect(sorted.map((item) => item.client.id)).toEqual(['new', 'visited', 'old']);
  });

  it('breaks ties by name', () => {
    const at = '2026-10-01T12:00:00.000Z';
    const sorted = sortByLastActivity([
      { client: client('1', { name: 'Zoe' }), lastVisit: at },
      { client: client('2', { name: 'Ángela' }), lastVisit: at },
    ]);
    expect(sorted.map((item) => item.client.name)).toEqual(['Ángela', 'Zoe']);
  });
});
