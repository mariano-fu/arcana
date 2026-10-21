import { chunkChanges, jsonBytes, PUSH_LIMITS } from './chunk';

describe('chunkChanges', () => {
  it('splits at 500 rows: 1201 rows go as 500, 500, 201, in order', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ i }));

    const chunks = chunkChanges(rows);

    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(rows);
  });

  it('splits before a chunk passes about 1 MB', () => {
    const row = { note: 'x'.repeat(300_000) };

    const chunks = chunkChanges([row, row, row, row, row]);

    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 2]);
    for (const chunk of chunks) expect(jsonBytes(chunk)).toBeLessThanOrEqual(PUSH_LIMITS.maxBytes);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const row = { note: 'ñ'.repeat(300_000) }; // 2 bytes each

    expect(chunkChanges([row, row]).map((chunk) => chunk.length)).toEqual([1, 1]);
  });

  it('sends a single row over the limit alone', () => {
    const big = { note: 'x'.repeat(1_500_000) };

    expect(chunkChanges([{ a: 1 }, big, { b: 2 }]).map((chunk) => chunk.length)).toEqual([1, 1, 1]);
  });

  it('returns no chunks for nothing to push', () => {
    expect(chunkChanges([])).toEqual([]);
  });
});
