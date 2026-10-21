// GeoNames → src/seed/cities.json, the pure part (no I/O). scripts/build-cities.ts downloads the
// files and calls `buildCities`.
//
// Selection (specs/plan.md, Cities):
// - Central America (BZ, GT, SV, HN, NI, CR, PA): every place in cities1000 (population ≥ 1000).
// - Rest of Latin America and Spain: cities15000.
// - Elsewhere: national capitals (feature code PPLC) from cities15000.
//
// Names:
// - City: the Spanish preferred alternate name (isolanguage `es` and isPreferredName = 1), else
//   the GeoNames name. A GeoNames name that differs stays searchable (`alt`).
// - Province / canton (admin1 / admin2): the Spanish preferred name, else the first Spanish name,
//   else the GeoNames name; then a fixed list of administrative prefixes and suffixes is
//   stripped ("Provincia de Alajuela" → "Alajuela", "Estado de Yucatán" → "Yucatán"), except
//   where the prefix is part of the name ("Distrito de Columbia").
// - Country: Spanish (Costa Rica) name from Intl.DisplayNames, resolved here at build time.
//
// Labels (unique across the file):
// - Costa Rica: city, canton, province ("San Rafael, Escazú, San José"), no country.
// - Latin America, Spain and the US: city, admin1, country.
// - Elsewhere: city, country; plus admin1 when another entry in the same country has the same
//   city name.
// - Consecutive repeated parts collapse ("San José, San José, San José" → "San José").
// - Collision rule, if two entries still share a label: add the next admin level (admin2;
//   Costa Rica has none after the canton) to every entry in the clash; if the labels still clash,
//   keep the most populous entry and drop the rest. Every resolution is reported.

export const CENTRAL_AMERICA = ['BZ', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA'] as const;
export const LATIN_AMERICA = [
  ...CENTRAL_AMERICA,
  'MX',
  'CU',
  'DO',
  'HT',
  'PR',
  'AR',
  'BO',
  'BR',
  'CL',
  'CO',
  'EC',
  'GF',
  'GY',
  'PE',
  'PY',
  'SR',
  'UY',
  'VE',
] as const;
/** Countries whose labels always include admin1. */
const ADMIN1_ALWAYS = new Set<string>([...LATIN_AMERICA, 'ES', 'US']);

/** Historical, abandoned or destroyed places are never birthplaces to offer. */
const EXCLUDED_FEATURE_CODES = new Set(['PPLH', 'PPLQ', 'PPLW']);

/** Feature codes in order of importance, for tie-breaking equal populations. */
const FEATURE_RANK = ['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLG', 'PPL'];

export interface GeoNamesCity {
  geonameid: string;
  name: string;
  lat: number;
  lng: number;
  featureCode: string;
  country: string;
  admin1: string;
  admin2: string;
  population: number;
  tz: string;
}

export interface AdminCode {
  name: string;
  geonameid: string;
}

export interface SpanishNames {
  preferred?: string;
  first?: string;
}

/** One entry of cities.json. */
export interface CityEntry {
  /** Display name of the city itself. */
  name: string;
  /** Full display label, unique in the file; stored as the client's `birth_place_label`. */
  label: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lng: number;
  /** IANA timezone. */
  tz: string;
  /** GeoNames name when it differs from `name`, so it stays searchable. */
  alt?: string;
}

export interface CollisionReport {
  label: string;
  resolution: 'next-admin-level' | 'kept-most-populous';
  kept: string[];
  dropped: string[];
}

const lines = (text: string) => text.split('\n').filter((line) => line.trim() !== '');

/** Rows of cities1000.txt / cities15000.txt (GeoNames "geoname" table, tab-separated). */
export function parseCities(text: string): GeoNamesCity[] {
  return lines(text).map((line) => {
    const f = line.split('\t');
    const at = (i: number) => f[i] ?? '';
    return {
      geonameid: at(0),
      name: at(1),
      lat: Number(at(4)),
      lng: Number(at(5)),
      featureCode: at(7),
      country: at(8),
      admin1: at(10),
      admin2: at(11),
      population: Number(at(14) || '0'),
      tz: at(17),
    };
  });
}

/** admin1CodesASCII.txt / admin2Codes.txt: `code \t name \t asciiname \t geonameid`. */
export function parseAdminCodes(text: string): Map<string, AdminCode> {
  const codes = new Map<string, AdminCode>();
  for (const line of lines(text)) {
    const [code = '', name = '', , geonameid = ''] = line.split('\t');
    codes.set(code, { name, geonameid });
  }
  return codes;
}

/**
 * Spanish names from a per-country alternateNames file (`alternatenames/XX.txt`): id, geonameid,
 * isolanguage, name, isPreferredName, isShortName, isColloquial, isHistoric, from, to.
 * Colloquial and historic names are ignored.
 */
export function parseSpanishNames(text: string, into = new Map<string, SpanishNames>()) {
  for (const line of lines(text)) {
    const [, geonameid = '', lang, name = '', preferred, , colloquial, historic] = line.split('\t');
    if (lang !== 'es' || colloquial === '1' || historic === '1' || name === '') continue;
    const entry = into.get(geonameid) ?? {};
    entry.first ??= name;
    if (preferred === '1') entry.preferred ??= name;
    into.set(geonameid, entry);
  }
  return into;
}

// Longest first, so "Provincia de X" is not cut to "de X". Matched ignoring case: some Spanish
// alternate names are lowercase ("departamento de Florida").
const ADMIN_PREFIXES = [
  'Comunidad Autónoma de las ',
  'Comunidad Autónoma de la ',
  'Comunidad Autónoma del ',
  'Comunidad Autónoma de ',
  'Ciudad Autónoma de ',
  'Comunidad Foral de ',
  'Departamento del ',
  'Departamento de ',
  'Departamento ',
  'Principado de ',
  'Provincia del ',
  'Provincia de ',
  'Provincia ',
  'Distrito de ',
  'Municipio de ',
  'Estado de ',
  'Estado ',
  'Región del ',
  'Región de ',
  'Cantón de ',
];
const ADMIN_SUFFIXES = [' Province', ' Department', ' District'];
/** Names where the "prefix" is part of the name. */
const ADMIN_KEEP = new Set(['Distrito de Columbia']);

export function stripAdminAffixes(name: string): string {
  if (ADMIN_KEEP.has(name)) return name;
  let result = name;
  const lower = name.toLowerCase();
  const prefix = ADMIN_PREFIXES.find((p) => lower.startsWith(p.toLowerCase()));
  if (prefix) result = result.slice(prefix.length);
  const suffix = ADMIN_SUFFIXES.find((s) => result.endsWith(s));
  if (suffix) result = result.slice(0, -suffix.length);
  // "las Islas Baleares" → "Islas Baleares"
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export function adminDisplayName(
  admin: AdminCode | undefined,
  spanish: Map<string, SpanishNames>,
): string | null {
  if (!admin) return null;
  const names = spanish.get(admin.geonameid);
  return stripAdminAffixes(names?.preferred ?? names?.first ?? admin.name);
}

export function selectCities(cities15000: GeoNamesCity[], cities1000: GeoNamesCity[]) {
  const centralAmerica = new Set<string>(CENTRAL_AMERICA);
  const restOfRegion = new Set<string>(
    [...LATIN_AMERICA, 'ES'].filter((c) => !centralAmerica.has(c)),
  );
  const selected = [
    ...cities1000.filter((c) => centralAmerica.has(c.country)),
    ...cities15000.filter(
      (c) =>
        !centralAmerica.has(c.country) && (restOfRegion.has(c.country) || c.featureCode === 'PPLC'),
    ),
  ];
  return selected.filter((c) => !EXCLUDED_FEATURE_CODES.has(c.featureCode) && c.tz !== '');
}

/** Most important first: population, then feature code, then GeoNames id. */
export function compareImportance(a: GeoNamesCity, b: GeoNamesCity): number {
  const rank = (c: GeoNamesCity) => {
    const i = FEATURE_RANK.indexOf(c.featureCode);
    return i === -1 ? FEATURE_RANK.length : i;
  };
  return (
    b.population - a.population || rank(a) - rank(b) || Number(a.geonameid) - Number(b.geonameid)
  );
}

/** Joins label parts, dropping empty ones and collapsing consecutive repeats. */
export function joinLabel(parts: (string | null)[]): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (part && part !== kept.at(-1)) kept.push(part);
  }
  return kept.join(', ');
}

export interface BuildInput {
  cities15000: GeoNamesCity[];
  cities1000: GeoNamesCity[];
  admin1: Map<string, AdminCode>;
  admin2: Map<string, AdminCode>;
  spanish: Map<string, SpanishNames>;
  countryName: (code: string) => string;
}

interface Draft {
  city: GeoNamesCity;
  name: string;
  admin1: string | null;
  admin2: string | null;
  country: string;
  label: string;
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

export function buildCities(input: BuildInput): {
  cities: CityEntry[];
  collisions: CollisionReport[];
} {
  const selected = selectCities(input.cities15000, input.cities1000).sort(compareImportance);

  const drafts: Draft[] = selected.map((city) => {
    const names = input.spanish.get(city.geonameid);
    return {
      city,
      name: names?.preferred ?? city.name,
      admin1: adminDisplayName(input.admin1.get(`${city.country}.${city.admin1}`), input.spanish),
      admin2: adminDisplayName(
        input.admin2.get(`${city.country}.${city.admin1}.${city.admin2}`),
        input.spanish,
      ),
      country: input.countryName(city.country),
      label: '',
    };
  });

  // Outside the always-admin1 countries, admin1 is added only where the city name repeats.
  const namesPerCountry = new Map<string, number>();
  for (const d of drafts) {
    const key = `${d.city.country}|${d.name}`;
    namesPerCountry.set(key, (namesPerCountry.get(key) ?? 0) + 1);
  }
  for (const d of drafts) {
    if (d.city.country === 'CR') {
      d.label = joinLabel([d.name, d.admin2, d.admin1]);
    } else if (
      ADMIN1_ALWAYS.has(d.city.country) ||
      (namesPerCountry.get(`${d.city.country}|${d.name}`) ?? 0) > 1
    ) {
      d.label = joinLabel([d.name, d.admin1, d.country]);
    } else {
      d.label = joinLabel([d.name, d.country]);
    }
  }

  const collisions: CollisionReport[] = [];
  const kept = new Set<Draft>(drafts);
  for (const group of groupByLabel(drafts)) {
    const label = group[0]?.label ?? '';
    // Next admin level: admin2, inserted after the city name. Costa Rica labels already have it.
    if (group.every((d) => d.city.country !== 'CR' && d.admin2 !== null)) {
      const relabeled = group.map((d) => joinLabel([d.name, d.admin2, d.admin1, d.country]));
      if (new Set(relabeled).size === group.length) {
        group.forEach((d, i) => {
          d.label = relabeled[i] ?? d.label;
        });
        collisions.push({
          label,
          resolution: 'next-admin-level',
          kept: group.map((d) => d.label),
          dropped: [],
        });
        continue;
      }
    }
    // `drafts` is sorted by importance, so the first entry is the most populous.
    const [first, ...rest] = group;
    rest.forEach((d) => kept.delete(d));
    collisions.push({
      label,
      resolution: 'kept-most-populous',
      kept: first ? [describe(first)] : [],
      dropped: rest.map(describe),
    });
  }

  const cities = drafts
    .filter((d) => kept.has(d))
    .map(({ city, name, label }): CityEntry => {
      const entry: CityEntry = {
        name,
        label,
        country: city.country,
        lat: round4(city.lat),
        lng: round4(city.lng),
        tz: city.tz,
      };
      if (city.name !== name) entry.alt = city.name;
      return entry;
    });
  return { cities, collisions };
}

function groupByLabel(drafts: Draft[]): Draft[][] {
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) groups.set(d.label, [...(groups.get(d.label) ?? []), d]);
  return [...groups.values()].filter((group) => group.length > 1);
}

const describe = (d: Draft) =>
  `${d.label} (geonameid ${d.city.geonameid}, ${d.city.featureCode}, pop. ${String(d.city.population)})`;
