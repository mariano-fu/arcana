// @vitest-environment node

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  adminDisplayName,
  buildCities,
  joinLabel,
  parseAdminCodes,
  parseCities,
  parseSpanishNames,
  stripAdminAffixes,
  type AdminCode,
  type BuildInput,
  type GeoNamesCity,
  type SpanishNames,
} from './cities.ts';

const COUNTRY_NAMES: Record<string, string> = {
  CR: 'Costa Rica',
  MX: 'México',
  US: 'Estados Unidos',
  FR: 'Francia',
  GB: 'Reino Unido',
  PA: 'Panamá',
};

let nextId = 1000;
function city(fields: Partial<GeoNamesCity>): GeoNamesCity {
  nextId += 1;
  return {
    geonameid: String(nextId),
    name: 'X',
    lat: 0,
    lng: 0,
    featureCode: 'PPL',
    country: 'CR',
    admin1: '',
    admin2: '',
    population: 0,
    tz: 'America/Costa_Rica',
    ...fields,
  };
}

function input(overrides: Partial<BuildInput>): BuildInput {
  return {
    cities15000: [],
    cities1000: [],
    admin1: new Map(),
    admin2: new Map(),
    spanish: new Map(),
    countryName: (code) => COUNTRY_NAMES[code] ?? code,
    ...overrides,
  };
}

const admin = (entries: Record<string, [string, string]>) =>
  new Map<string, AdminCode>(
    Object.entries(entries).map(([code, [name, geonameid]]) => [code, { name, geonameid }]),
  );

describe('GeoNames parsers', () => {
  it('reads the fields it needs from a geoname row', () => {
    const row = [
      '3621849',
      'San José',
      'San Jose',
      'alt',
      '9.93333',
      '-84.08333',
      'P',
      'PPLC',
      'CR',
      '',
      '08',
      '101',
      '',
      '',
      '335007',
      '',
      '1161',
      'America/Costa_Rica',
      '2024-01-01',
    ].join('\t');
    expect(parseCities(`${row}\n`)).toEqual([
      {
        geonameid: '3621849',
        name: 'San José',
        lat: 9.93333,
        lng: -84.08333,
        featureCode: 'PPLC',
        country: 'CR',
        admin1: '08',
        admin2: '101',
        population: 335007,
        tz: 'America/Costa_Rica',
      },
    ]);
  });

  it('reads admin codes', () => {
    expect(parseAdminCodes('CR.01\tAlajuela Province\tAlajuela Province\t3624953\n')).toEqual(
      new Map([['CR.01', { name: 'Alajuela Province', geonameid: '3624953' }]]),
    );
  });

  it('keeps the first and the preferred Spanish name, skipping colloquial and historic ones', () => {
    const rows = [
      ['1', '42', 'en', 'Zarcero canton', '', '', '', ''],
      ['2', '42', 'es', 'Viejo Zarcero', '', '', '', '1'],
      ['3', '42', 'es', 'Zarcerito', '', '', '1', ''],
      ['4', '42', 'es', 'Zarcero', '', '', '', ''],
      ['5', '42', 'es', 'Cantón de Zarcero', '1', '', '', ''],
      ['6', '43', 'es', 'Sin preferido', '', '', '', ''],
    ];
    const names = parseSpanishNames(rows.map((r) => r.join('\t')).join('\n'));
    expect(names.get('42')).toEqual({ first: 'Zarcero', preferred: 'Cantón de Zarcero' });
    expect(names.get('43')).toEqual({ first: 'Sin preferido' });
  });
});

describe('admin names', () => {
  it.each([
    ['Provincia de Alajuela', 'Alajuela'],
    ['Alajuela Province', 'Alajuela'],
    ['Cantón de Zarcero', 'Zarcero'],
    ['Estado de Yucatán', 'Yucatán'],
    ['Estado Apure', 'Apure'],
    ['Provincia La Vega', 'La Vega'],
    ['Provincia del Chaco', 'Chaco'],
    ['Región del Maule', 'Maule'],
    ['departamento de Florida', 'Florida'],
    ['Distrito de Soná', 'Soná'],
    ['Municipio de Omoa', 'Omoa'],
    ['Dolega District', 'Dolega'],
    ['Comunidad Autónoma de las Islas Baleares', 'Islas Baleares'],
    ['Comunidad Autónoma del País Vasco', 'País Vasco'],
    ['Comunidad Foral de Navarra', 'Navarra'],
    ['Principado de Asturias', 'Asturias'],
    ['Comunidad Valenciana', 'Comunidad Valenciana'],
    ['Ciudad de México', 'Ciudad de México'],
    ['Distrito Federal', 'Distrito Federal'],
    ['Distrito de Columbia', 'Distrito de Columbia'],
    ['Región Metropolitana de Santiago de Chile', 'Región Metropolitana de Santiago de Chile'],
  ])('%s → %s', (name, expected) => {
    expect(stripAdminAffixes(name)).toBe(expected);
  });

  it('prefers the preferred Spanish name, then the first Spanish name, then GeoNames', () => {
    const spanish = new Map<string, SpanishNames>([
      ['1', { first: 'Yucatán', preferred: 'Estado de Yucatán' }],
      ['2', { first: 'Provincia de Alajuela' }],
    ]);
    expect(adminDisplayName({ name: 'Yucatan', geonameid: '1' }, spanish)).toBe('Yucatán');
    expect(adminDisplayName({ name: 'Alajuela Province', geonameid: '2' }, spanish)).toBe(
      'Alajuela',
    );
    expect(adminDisplayName({ name: 'Heredia Province', geonameid: '3' }, spanish)).toBe('Heredia');
    expect(adminDisplayName(undefined, spanish)).toBeNull();
  });
});

describe('joinLabel', () => {
  it('drops empty parts and collapses consecutive repeats', () => {
    expect(joinLabel(['San José', 'San José', 'San José'])).toBe('San José');
    expect(joinLabel(['Escazú', 'Escazú', 'San José'])).toBe('Escazú, San José');
    expect(joinLabel(['Liberia', null, 'Guanacaste'])).toBe('Liberia, Guanacaste');
  });
});

describe('buildCities', () => {
  const crAdmin1 = admin({ 'CR.08': ['San José', '10'], 'CR.01': ['Alajuela Province', '11'] });
  const crAdmin2 = admin({
    'CR.08.102': ['Escazú', '20'],
    'CR.01.202': ['San Ramón', '21'],
  });

  it('selects Central America from cities1000 and the rest from cities15000', () => {
    const { cities } = buildCities(
      input({
        cities1000: [
          city({ name: 'Pueblito', country: 'CR', population: 1200 }),
          city({ name: 'Aldea', country: 'MX', tz: 'America/Mexico_City' }),
        ],
        cities15000: [
          city({ name: 'Pueblito', country: 'CR', population: 1200 }),
          city({ name: 'Puebla', country: 'MX', tz: 'America/Mexico_City' }),
          city({ name: 'Lyon', country: 'FR', tz: 'Europe/Paris' }),
          city({ name: 'Paris', country: 'FR', featureCode: 'PPLC', tz: 'Europe/Paris' }),
          city({ name: 'Ruinas', country: 'MX', featureCode: 'PPLQ' }),
        ],
      }),
    );
    expect(cities.map((c) => c.name).sort()).toEqual(['Paris', 'Puebla', 'Pueblito']);
  });

  it('labels Costa Rica as city, canton, province, without the country', () => {
    const { cities } = buildCities(
      input({
        admin1: crAdmin1,
        admin2: crAdmin2,
        cities1000: [
          city({ name: 'San Rafael', admin1: '08', admin2: '102', population: 25410 }),
          city({ name: 'San Rafael', admin1: '01', admin2: '202', population: 3624 }),
          city({ name: 'Escazú', admin1: '08', admin2: '102', population: 12071 }),
        ],
      }),
    );
    expect(cities.map((c) => c.label)).toEqual([
      'San Rafael, Escazú, San José',
      'Escazú, San José',
      'San Rafael, San Ramón, Alajuela',
    ]);
  });

  it('uses the Spanish preferred city name and keeps the GeoNames name searchable', () => {
    const { cities } = buildCities(
      input({
        admin1: admin({ 'MX.09': ['Mexico City', '30'], 'GB.ENG': ['England', '31'] }),
        spanish: new Map([
          ['500', { first: 'Ciudad de México', preferred: 'Ciudad de México' }],
          ['30', { first: 'Ciudad de México', preferred: 'Ciudad de México' }],
          ['501', { first: 'Londres' }],
        ]),
        cities15000: [
          city({
            geonameid: '500',
            name: 'Mexico City',
            country: 'MX',
            admin1: '09',
            population: 2,
          }),
          city({
            geonameid: '501',
            name: 'London',
            country: 'GB',
            featureCode: 'PPLC',
            population: 1,
          }),
        ],
      }),
    );
    expect(cities).toEqual([
      expect.objectContaining({
        name: 'Ciudad de México',
        label: 'Ciudad de México, México',
        alt: 'Mexico City',
      }),
      expect.objectContaining({ name: 'London', label: 'London, Reino Unido' }),
    ]);
    expect(cities[1]).not.toHaveProperty('alt');
  });

  it('adds admin1 outside Latin America, Spain and the US only when the city name repeats', () => {
    const { cities } = buildCities(
      input({
        admin1: admin({
          'US.OR': ['Oregon', '40'],
          'US.ME': ['Maine', '41'],
          'FR.11': ['Île-de-France', '42'],
          'FR.84': ['Auvergne-Rhône-Alpes', '43'],
          'GB.ENG': ['England', '44'],
        }),
        spanish: new Map([['40', { first: 'Oregón', preferred: 'Oregón' }]]),
        cities15000: [
          city({
            name: 'Portland',
            country: 'US',
            admin1: 'OR',
            featureCode: 'PPLC',
            population: 9,
          }),
          city({ name: 'Paris', country: 'FR', admin1: '11', featureCode: 'PPLC', population: 8 }),
          city({ name: 'Paris', country: 'FR', admin1: '84', featureCode: 'PPLC', population: 7 }),
          city({
            name: 'London',
            country: 'GB',
            admin1: 'ENG',
            featureCode: 'PPLC',
            population: 6,
          }),
        ],
      }),
    );
    expect(cities.map((c) => c.label)).toEqual([
      'Portland, Oregón, Estados Unidos',
      'Paris, Île-de-France, Francia',
      'Paris, Auvergne-Rhône-Alpes, Francia',
      'London, Reino Unido',
    ]);
  });

  it('resolves a label collision with the next admin level when that makes labels unique', () => {
    const { cities, collisions } = buildCities(
      input({
        admin1: admin({ 'PA.10': ['Panamá Oeste', '50'] }),
        admin2: admin({
          'PA.10.1': ['Distrito de Arraiján', '51'],
          'PA.10.2': ['Distrito de San Carlos', '52'],
        }),
        cities1000: [
          city({ name: 'San José', country: 'PA', admin1: '10', admin2: '1', population: 2 }),
          city({ name: 'San José', country: 'PA', admin1: '10', admin2: '2', population: 1 }),
        ],
      }),
    );
    expect(cities.map((c) => c.label)).toEqual([
      'San José, Arraiján, Panamá Oeste, Panamá',
      'San José, San Carlos, Panamá Oeste, Panamá',
    ]);
    expect(collisions).toEqual([
      expect.objectContaining({
        label: 'San José, Panamá Oeste, Panamá',
        resolution: 'next-admin-level',
      }),
    ]);
  });

  it('keeps the most populous entry when no admin level separates the labels', () => {
    const { cities, collisions } = buildCities(
      input({
        admin1: crAdmin1,
        admin2: crAdmin2,
        cities1000: [
          city({ name: 'Bello Horizonte', admin1: '08', admin2: '102', population: 100 }),
          city({ name: 'Bello Horizonte', admin1: '08', admin2: '102', population: 900 }),
        ],
      }),
    );
    expect(cities).toEqual([
      expect.objectContaining({ label: 'Bello Horizonte, Escazú, San José' }),
    ]);
    expect(collisions).toEqual([
      expect.objectContaining({
        resolution: 'kept-most-populous',
        kept: [expect.stringContaining('pop. 900')],
        dropped: [expect.stringContaining('pop. 100')],
      }),
    ]);
  });

  it('sorts by population and rounds coordinates to 4 decimals', () => {
    const { cities } = buildCities(
      input({
        admin1: crAdmin1,
        cities1000: [
          city({ name: 'Chico', admin1: '08', population: 10, lat: 9.123456, lng: -84.987654 }),
          city({ name: 'Grande', admin1: '01', population: 99 }),
        ],
      }),
    );
    expect(cities.map((c) => c.name)).toEqual(['Grande', 'Chico']);
    expect(cities[1]).toMatchObject({ lat: 9.1235, lng: -84.9877 });
  });
});

describe('generated src/seed/cities.json', () => {
  it('stays under 1 MB gzipped (specs/plan.md, Cities)', () => {
    const bytes = readFileSync(new URL('../src/seed/cities.json', import.meta.url));
    expect(gzipSync(bytes).length).toBeLessThan(1_000_000);
  });
});
