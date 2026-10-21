// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { citiesChunkErrors, precachedUrls } from './precache.ts';

const SW =
  'e.precacheAndRoute([{url:"assets/cities-AbC_1.js",revision:null},{url:"index.html",revision:"1"}])';
const LIMIT = 2 * 1024 * 1024;

describe('precachedUrls', () => {
  it('reads the URLs Workbox inlines into sw.js', () => {
    expect(precachedUrls(SW)).toEqual(['assets/cities-AbC_1.js', 'index.html']);
  });
});

describe('citiesChunkErrors', () => {
  const assets = ['assets/index-x.js', 'assets/cities-AbC_1.js'];

  it('passes when the chunk is precached and under the limit', () => {
    expect(citiesChunkErrors(assets, SW, () => 900_000, LIMIT)).toEqual({
      errors: [],
      check: { chunk: 'assets/cities-AbC_1.js', bytes: 900_000 },
    });
  });

  it('fails when the chunk is missing from the precache manifest', () => {
    const { errors } = citiesChunkErrors(assets, 'e.precacheAndRoute([])', () => 1, LIMIT);
    expect(errors).toEqual([
      'assets/cities-AbC_1.js is not in the service worker precache manifest',
    ]);
  });

  it('fails at or over the Workbox size limit', () => {
    const { errors } = citiesChunkErrors(assets, SW, () => LIMIT, LIMIT);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('over Workbox');
  });

  it('fails when the build has no cities chunk', () => {
    expect(citiesChunkErrors(['assets/index-x.js'], SW, () => 1, LIMIT).errors).toEqual([
      'expected one cities chunk in dist/assets, found 0',
    ]);
  });
});
