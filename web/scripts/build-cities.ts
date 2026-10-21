// Builds src/seed/cities.json from GeoNames (CC BY 4.0). Selection, naming and label rules,
// including the collision rule, are in scripts/cities.ts.
// Downloads are cached in web/.cache/geonames/ (gitignored); delete it to refresh.
// Usage: npm run build:cities (needs network; never run in CI)

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import { unzipSync } from 'fflate';

import {
  buildCities,
  parseAdminCodes,
  parseCities,
  parseSpanishNames,
  selectCities,
  type SpanishNames,
} from './cities.ts';

const DUMP_URL = 'https://download.geonames.org/export/dump/';
const CACHE_DIR = new URL('../.cache/geonames/', import.meta.url);
const OUTPUT_PATH = new URL('../src/seed/cities.json', import.meta.url);

async function exists(url: URL): Promise<boolean> {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
}

/** A GeoNames dump file, from the cache or downloaded into it. */
async function download(path: string): Promise<Uint8Array> {
  const cached = new URL(path.replaceAll('/', '__'), CACHE_DIR);
  if (await exists(cached)) return new Uint8Array(await readFile(cached));
  const response = await fetch(DUMP_URL + path);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(cached, bytes);
  return bytes;
}

/** Text of `name` inside the zip `path`. */
async function unzipText(path: string, name: string): Promise<string> {
  const file = unzipSync(await download(path), { filter: (entry) => entry.name === name })[name];
  if (!file) throw new Error(`${path} has no ${name}`);
  return new TextDecoder().decode(file);
}

async function text(path: string): Promise<string> {
  return new TextDecoder().decode(await download(path));
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const cities15000 = parseCities(await unzipText('cities15000.zip', 'cities15000.txt'));
  const cities1000 = parseCities(await unzipText('cities1000.zip', 'cities1000.txt'));
  const admin1 = parseAdminCodes(await text('admin1CodesASCII.txt'));
  const admin2 = parseAdminCodes(await text('admin2Codes.txt'));

  // Spanish alternate names only for the countries that end up in the file.
  const countries = [
    ...new Set(selectCities(cities15000, cities1000).map((c) => c.country)),
  ].sort();
  const spanish = new Map<string, SpanishNames>();
  for (const country of countries) {
    console.log(`alternate names: ${country}`);
    parseSpanishNames(await unzipText(`alternatenames/${country}.zip`, `${country}.txt`), spanish);
  }

  const regionNames = new Intl.DisplayNames(['es-CR'], { type: 'region' });
  const { cities, collisions } = buildCities({
    cities15000,
    cities1000,
    admin1,
    admin2,
    spanish,
    countryName: (code) => regionNames.of(code) ?? code,
  });

  const file = {
    source: {
      name: 'GeoNames',
      url: 'https://www.geonames.org/',
      license: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
      files: [
        'cities1000.zip (Central America)',
        'cities15000.zip (rest of Latin America, Spain, world capitals)',
        'admin1CodesASCII.txt',
        'admin2Codes.txt',
        'alternatenames/<country>.zip',
      ],
      downloaded: new Date().toISOString().slice(0, 10),
      countryNames: `Intl.DisplayNames es-CR, Node ${process.versions.node}, ICU ${process.versions.icu ?? '?'}`,
      script: 'web/scripts/build-cities.ts',
    },
    cities,
  };
  // One city per line keeps diffs readable when GeoNames is refreshed.
  const body = cities.map((city) => `  ${JSON.stringify(city)}`).join(',\n');
  const header = JSON.stringify({ source: file.source }, null, 2).slice(0, -2);
  await writeFile(OUTPUT_PATH, `${header},\n  "cities": [\n${body}\n  ]\n}\n`);

  console.log(`\n${String(cities.length)} cities written to src/seed/cities.json`);
  console.log(`${String(collisions.length)} label collisions resolved:`);
  for (const c of collisions) {
    console.log(`- "${c.label}" (${c.resolution})`);
    c.kept.forEach((label) => {
      console.log(`    kept:    ${label}`);
    });
    c.dropped.forEach((label) => {
      console.log(`    dropped: ${label}`);
    });
  }
}

await main();
