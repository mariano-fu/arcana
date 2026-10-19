import { newestFirst } from './timeline';

describe('newestFirst', () => {
  it('sorts by start time, newest first, then by id', () => {
    const sessions = [
      { id: 'a', started_at: '2026-09-01T10:00:00.000Z' },
      { id: 'b', started_at: '2026-10-01T10:00:00.000Z' },
      { id: 'c', started_at: '2026-09-01T10:00:00.000Z' },
    ];

    expect(newestFirst(sessions).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    // Doesn't mutate its input.
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
