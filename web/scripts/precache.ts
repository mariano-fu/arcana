// Checks for the generated service worker (dist/sw.js), used by scripts/check-precache.ts after
// `vite build`. Workbox skips any file over `maximumFileSizeToCacheInBytes` with only a warning,
// so a city list that grew too big would silently stop working offline.

/** Matches the lazily imported city list chunk (src/seed/cities.json). */
export const CITIES_CHUNK = /^assets\/cities-[\w-]+\.js$/;

/** Plan target for the city list, gzipped (specs/plan.md, Cities). */
export const CITIES_GZIP_TARGET_BYTES = 1_000_000;

/** URLs in the precache manifest that Workbox inlines into sw.js. */
export function precachedUrls(swSource: string): string[] {
  return [...swSource.matchAll(/\burl:\s*"([^"]+)"/g)].map((match) => match[1] ?? '');
}

export interface ChunkCheck {
  chunk: string;
  bytes: number;
}

/** Problems with the cities chunk; empty when it is precached and under the size limit. */
export function citiesChunkErrors(
  assets: string[],
  swSource: string,
  sizeOf: (path: string) => number,
  maxBytes: number,
): { errors: string[]; check?: ChunkCheck } {
  const chunks = assets.filter((asset) => CITIES_CHUNK.test(asset));
  if (chunks.length !== 1) {
    return { errors: [`expected one cities chunk in dist/assets, found ${String(chunks.length)}`] };
  }
  const chunk = chunks[0] ?? '';
  const bytes = sizeOf(chunk);
  const errors: string[] = [];
  if (!precachedUrls(swSource).includes(chunk)) {
    errors.push(`${chunk} is not in the service worker precache manifest`);
  }
  if (bytes >= maxBytes) {
    errors.push(
      `${chunk} is ${String(bytes)} bytes, at or over Workbox's ${String(maxBytes)}-byte limit`,
    );
  }
  return { errors, check: { chunk, bytes } };
}
