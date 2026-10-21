// Birth-place city list: the generated `cities.json` (GeoNames, CC BY 4.0; see
// scripts/cities.ts for selection and label rules) and an offline search over it.
//
// The file is ~1 MB, so it is imported lazily: Vite emits it as its own chunk, which the
// service worker precaches (scripts/check-precache.ts fails the build otherwise), so the first
// search works offline too.

import { z } from 'zod';

export const citySchema = z.strictObject({
  name: z.string().min(1),
  /** Unique display label; becomes the client's `birth_place_label`. */
  label: z.string().min(1),
  /** ISO 3166-1 alpha-2. */
  country: z.string().regex(/^[A-Z]{2}$/),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** IANA timezone. */
  tz: z.string().min(1),
  /** GeoNames name when it differs from `name`; searchable, not shown. */
  alt: z.string().min(1).optional(),
});

export type City = z.infer<typeof citySchema>;

/** Most results the autocomplete shows (fits above the iPhone keyboard). */
export const MAX_RESULTS = 8;

/** Lowercase, without accents or punctuation, single-spaced. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

interface IndexedCity {
  city: City;
  /** Normalized city name and GeoNames name. */
  names: string[];
  /** Words of the whole label plus the GeoNames name. */
  words: string[];
}

export interface CityIndex {
  cities: readonly City[];
  entries: readonly IndexedCity[];
}

/** Cities must be ordered most populous first; ties in ranking keep that order. */
export function indexCities(cities: readonly City[]): CityIndex {
  return {
    cities,
    entries: cities.map((city) => {
      const names = [city.name, city.alt].filter((n) => n !== undefined).map(normalizeForSearch);
      const words = normalizeForSearch(`${city.label} ${city.alt ?? ''}`).split(' ');
      return { city, names, words };
    }),
  };
}

/**
 * Cities matching `query`: every query word must start a word of the label (or of the GeoNames
 * name). Ranked: city name starts with the whole query, then a word of the city name starts
 * with the first query word, then any other match; within a rank, most populous first.
 */
export function searchCities(index: CityIndex, query: string, limit = MAX_RESULTS): City[] {
  const normalized = normalizeForSearch(query);
  if (normalized === '') return [];
  const tokens = normalized.split(' ');
  const first = tokens[0] ?? '';

  const ranked: City[][] = [[], [], []];
  for (const { city, names, words } of index.entries) {
    if (!tokens.every((token) => words.some((word) => word.startsWith(token)))) continue;
    const rank = names.some((name) => name.startsWith(normalized))
      ? 0
      : names.some((name) => name.split(' ').some((word) => word.startsWith(first)))
        ? 1
        : 2;
    ranked[rank]?.push(city);
  }
  return ranked.flat().slice(0, limit);
}

let loading: Promise<CityIndex> | undefined;

/** Loads and indexes the city list once. */
export function loadCities(): Promise<CityIndex> {
  loading ??= import('./cities.json').then(({ default: file }) => indexCities(file.cities));
  return loading;
}
