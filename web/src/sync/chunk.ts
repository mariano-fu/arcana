// Pushes are split so no request exceeds the server's 500-row cap, and none grows past about
// 1 MB (a slow phone connection should finish each request; the server accepts up to 10 MB).

export interface ChunkLimits {
  maxRows: number;
  /** UTF-8 bytes of the JSON-encoded changes. A single larger change still goes, alone. */
  maxBytes: number;
}

export const PUSH_LIMITS: ChunkLimits = { maxRows: 500, maxBytes: 1_000_000 };

const encoder = new TextEncoder();

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Consecutive chunks in the given order (the push order: parents first). */
export function chunkChanges<T>(changes: readonly T[], limits: ChunkLimits = PUSH_LIMITS): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const change of changes) {
    const size = jsonBytes(change) + 1; // + the separating comma
    if (
      current.length > 0 &&
      (current.length >= limits.maxRows || bytes + size > limits.maxBytes)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(change);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
