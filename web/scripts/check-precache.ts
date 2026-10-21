// Fails the build if the city list chunk is missing from the service worker precache or is too
// big for Workbox to precache, and reports its gzipped size against the plan's target.
// Runs after `vite build` (npm run build).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { MAX_PRECACHE_FILE_BYTES } from '../pwa.config.ts';
import { CITIES_GZIP_TARGET_BYTES, citiesChunkErrors } from './precache.ts';

const DIST = new URL('../dist/', import.meta.url);

const assets = readdirSync(new URL('assets/', DIST)).map((name) => `assets/${name}`);
const swSource = readFileSync(new URL('sw.js', DIST), 'utf8');
const { errors, check } = citiesChunkErrors(
  assets,
  swSource,
  (path) => statSync(new URL(path, DIST)).size,
  MAX_PRECACHE_FILE_BYTES,
);

if (check) {
  const gzipBytes = gzipSync(readFileSync(new URL(check.chunk, DIST))).length;
  const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;
  const kB = (bytes: number) => `${(bytes / 1000).toFixed(0)} kB`;
  console.log(
    `${check.chunk}: ${kib(check.bytes)} (precache limit ${kib(MAX_PRECACHE_FILE_BYTES)}), ` +
      `${kB(gzipBytes)} gzipped (target < ${kB(CITIES_GZIP_TARGET_BYTES)})`,
  );
  if (gzipBytes >= CITIES_GZIP_TARGET_BYTES) {
    console.warn('warning: the city list is over its gzipped size target');
  }
}
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
