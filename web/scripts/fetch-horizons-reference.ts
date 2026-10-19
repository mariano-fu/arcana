// Regenerates src/astro/fixtures/horizons-reference.json from NASA JPL Horizons.
// Usage: node scripts/fetch-horizons-reference.ts (needs network; never run in CI)
//
// Horizons is an independent reference: astronomy-engine's own models are not involved.
// QUANTITIES='31' is the observer-centered ecliptic-of-date longitude/latitude of the apparent
// position (light-time, deflection and aberration corrected), which is the tropical-zodiac frame
// `planetPositions` returns.

import { writeFile } from 'node:fs/promises';

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const FIXTURE_PATH = new URL('../src/astro/fixtures/horizons-reference.json', import.meta.url);

/** Horizons target ids (Sun, Moon, then planet bodies, not barycenters). */
const BODIES = {
  sun: '10',
  moon: '301',
  mercury: '199',
  venus: '299',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
} as const;

/** Generic instants spread across 1950–2030 at varied times of day (no real people). */
const INSTANTS = [
  '1950-03-11T06:00:00Z',
  '1957-10-04T19:28:00Z',
  '1963-07-20T14:45:00Z',
  '1969-07-20T20:17:00Z',
  '1977-01-15T03:30:00Z',
  '1984-11-02T22:10:00Z',
  '1991-05-27T09:05:00Z',
  '1998-08-30T16:40:00Z',
  '2004-02-29T00:15:00Z',
  '2011-12-10T11:55:00Z',
  '2019-06-21T05:00:00Z',
  '2025-09-07T18:30:00Z',
  '2030-12-31T23:59:00Z',
];

const BASE_PARAMS = {
  format: 'json',
  MAKE_EPHEM: 'YES',
  OBJ_DATA: 'NO',
  EPHEM_TYPE: 'OBSERVER',
  CENTER: '500@399',
  QUANTITIES: '31',
  TIME_TYPE: 'UT',
  TLIST_TYPE: 'JD',
  ANG_FORMAT: 'DEG',
  CAL_FORMAT: 'CAL',
  TIME_DIGITS: 'SECONDS',
  CSV_FORMAT: 'YES',
};

const julianDay = (iso: string) => (Date.parse(iso) / 86_400_000 + 2_440_587.5).toFixed(9);

/** Horizons calendar date ("2000-Jan-01 12:00:00") → ISO, to check rows line up with requests. */
function horizonsDateToIso(text: string): string {
  const parsed = new Date(`${text.trim().replace(/^(\d{4})-(\w{3})-(\d{2})/, '$2 $3 $1')} UTC`);
  return parsed.toISOString().replace('.000Z', 'Z');
}

async function fetchLongitudes(id: string): Promise<{ longitudes: number[]; source: string }> {
  const params = new URLSearchParams({
    ...BASE_PARAMS,
    COMMAND: `'${id}'`,
    TLIST: INSTANTS.map(julianDay).join(' '),
  });
  const response = await fetch(`${API_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Horizons returned HTTP ${String(response.status)} for body ${id}`);
  }
  const { result } = (await response.json()) as { result: string };
  const table = /\$\$SOE\n([\s\S]*?)\$\$EOE/.exec(result)?.[1];
  const source = /Target body name:.*\{source: (\w+)\}/.exec(result)?.[1];
  if (table === undefined || source === undefined) {
    throw new Error(`Unexpected Horizons output for body ${id}:\n${result}`);
  }
  const rows = table.trim().split('\n');
  if (rows.length !== INSTANTS.length) {
    throw new Error(
      `Expected ${String(INSTANTS.length)} rows for body ${id}, got ${String(rows.length)}`,
    );
  }
  const longitudes = rows.map((row, i) => {
    // CSV columns: date, solar-presence flag, lunar-presence flag, ObsEcLon, ObsEcLat, (empty)
    const cells = row.split(',').map((cell) => cell.trim());
    const iso = horizonsDateToIso(cells[0] ?? '');
    if (iso !== INSTANTS[i]) {
      throw new Error(
        `Row ${String(i)} of body ${id} is for ${iso}, expected ${String(INSTANTS[i])}`,
      );
    }
    return Number(cells[3]);
  });
  return { longitudes, source };
}

// One request at a time: Horizons answers concurrent requests with HTTP 503.
const results: Record<string, { longitudes: number[]; source: string }> = {};
for (const [key, id] of Object.entries(BODIES)) {
  results[key] = await fetchLongitudes(id);
}
const ephemerides = [...new Set(Object.values(results).map((r) => r.source))];

const fixture = {
  source: {
    name: 'NASA JPL Horizons System',
    url: API_URL,
    ephemeris: ephemerides.join(', '),
    retrieved: new Date().toISOString().slice(0, 10),
    script: 'web/scripts/fetch-horizons-reference.ts',
    query: BASE_PARAMS,
    bodies: BODIES,
    note: 'Geocentric apparent longitude on the true ecliptic of date (QUANTITIES 31, ObsEcLon), degrees.',
  },
  cases: INSTANTS.map((utc, i) => ({
    utc,
    longitudes: Object.fromEntries(
      Object.entries(results).map(([key, r]) => [key, r.longitudes[i]]),
    ),
  })),
};

await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${FIXTURE_PATH.pathname}`);
