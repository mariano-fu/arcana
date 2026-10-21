import { IANAZone } from 'luxon';

import file from './cities.json';
import {
  citySchema,
  indexCities,
  loadCities,
  MAX_RESULTS,
  normalizeForSearch,
  searchCities,
  type City,
} from './cities.ts';

const cities: City[] = file.cities.map((city) => citySchema.parse(city));
const byLabel = new Map(cities.map((city) => [city.label, city]));
const index = indexCities(cities);
const labels = (query: string, limit?: number) =>
  searchCities(index, query, limit).map((city) => city.label);

describe('cities.json', () => {
  it('records its GeoNames source and license', () => {
    expect(file.source).toMatchObject({
      name: 'GeoNames',
      url: 'https://www.geonames.org/',
      license: expect.stringContaining('CC BY 4.0') as unknown,
    });
  });

  it('matches the schema, with valid IANA timezones', () => {
    expect(cities.length).toBeGreaterThan(5000);
    const zones = new Set(cities.map((city) => city.tz));
    for (const zone of zones) expect(IANAZone.isValidZone(zone), zone).toBe(true);
  });

  it('has a unique label for every city', () => {
    const seen = new Set<string>();
    const duplicates = cities.filter((city) => seen.size === seen.add(city.label).size);
    expect(duplicates.map((city) => city.label)).toEqual([]);
  });

  it('covers Costa Rica down to small towns, labelled city, canton, province', () => {
    const costaRica = cities.filter((city) => city.country === 'CR');
    expect(costaRica.length).toBeGreaterThanOrEqual(100);
    for (const city of costaRica) {
      expect(city.tz).toBe('America/Costa_Rica');
      expect(city.label).not.toMatch(/Costa Rica$/);
    }
    expect(byLabel.get('San Rafael, Escazú, San José')).toMatchObject({ name: 'San Rafael' });
    expect(byLabel.get('San Rafael, San Ramón, Alajuela')).toMatchObject({ name: 'San Rafael' });
    expect(byLabel.get('San José')).toMatchObject({ name: 'San José', lat: 9.9339 });
  });

  it('names the seven Costa Rican provinces in plain Spanish', () => {
    const provinces = new Set(
      cities.filter((city) => city.country === 'CR').map((city) => city.label.split(', ').at(-1)),
    );
    expect([...provinces].sort()).toEqual([
      'Alajuela',
      'Cartago',
      'Guanacaste',
      'Heredia',
      'Limón',
      'Puntarenas',
      'San José',
    ]);
  });

  it.each([
    ['Escazú, San José', 'CR'],
    ['Zarcero, Alajuela', 'CR'],
    ['Liberia, Guanacaste', 'CR'],
    ['Ciudad de México, México', 'MX'],
    ['Sevilla, Andalucía, España', 'ES'],
    ['Madrid, España', 'ES'],
    ['Managua, Nicaragua', 'NI'],
    ['Buenos Aires, Argentina', 'AR'],
    ['Washington, Distrito de Columbia, Estados Unidos', 'US'],
  ])('has "%s" with Spanish country names baked in', (label, country) => {
    expect(byLabel.get(label)).toMatchObject({ country });
  });
});

describe('normalizeForSearch', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeForSearch('  San JOSÉ,  Escazú ')).toBe('san jose escazu');
    expect(normalizeForSearch('São Paulo')).toBe('sao paulo');
  });
});

describe('searchCities', () => {
  it('finds cities without accents and ranks the closest name first', () => {
    expect(labels('escazu')[0]).toBe('Escazú, San José');
    expect(labels('SAN JOSE')[0]).toBe('San José');
  });

  it('returns at most 8 results, or fewer when asked', () => {
    expect(labels('san')).toHaveLength(MAX_RESULTS);
    expect(labels('san', 3)).toHaveLength(3);
  });

  it('keeps same-name places distinguishable by their labels', () => {
    const results = labels('san rafael escazu');
    expect(results).toContain('San Rafael, Escazú, San José');
    expect(new Set(labels('san rafael')).size).toBe(labels('san rafael').length);
  });

  it('narrows with words from the canton, province or country', () => {
    expect(labels('san rafael alajuela')).toContain('San Rafael, San Ramón, Alajuela');
    expect(labels('sevilla colombia')).toEqual(['Sevilla, Valle del Cauca, Colombia']);
  });

  it('matches the GeoNames name kept as `alt`', () => {
    expect(labels('mexico city')[0]).toBe('Ciudad de México, México');
  });

  it('returns nothing for an empty query or no match', () => {
    expect(labels('  ')).toEqual([]);
    expect(labels('zzzzqx')).toEqual([]);
  });

  it('ranks by name match, then by population order', () => {
    const tiny = indexCities([
      { name: 'Grande', label: 'Grande, Sanabria', country: 'CR', lat: 0, lng: 0, tz: 'UTC' },
      { name: 'Villa San', label: 'Villa San, B', country: 'CR', lat: 0, lng: 0, tz: 'UTC' },
      { name: 'Sanatorio', label: 'Sanatorio, C', country: 'CR', lat: 0, lng: 0, tz: 'UTC' },
    ]);
    expect(searchCities(tiny, 'san').map((city) => city.name)).toEqual([
      'Sanatorio',
      'Villa San',
      'Grande',
    ]);
  });
});

describe('loadCities', () => {
  it('loads the bundled list once', async () => {
    const first = await loadCities();
    expect(first.cities).toHaveLength(cities.length);
    expect(await loadCities()).toBe(first);
  });
});
