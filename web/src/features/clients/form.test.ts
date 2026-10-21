import { clientToForm, emptyClientForm, parseClientForm, parseTags } from './form';
import { newClient } from './test-utils';

const form = (overrides: Partial<ReturnType<typeof emptyClientForm>> = {}) => ({
  ...emptyClientForm(),
  ...overrides,
});

describe('parseClientForm', () => {
  it('accepts a client with only a name, storing blanks as null', () => {
    const result = parseClientForm(form({ name: '  Ana  ' }));
    expect(result).toEqual({
      ok: true,
      fields: {
        name: 'Ana',
        instagram: null,
        whatsapp: null,
        email: null,
        birth_date: null,
        birth_time: null,
        birth_place_label: null,
        birth_lat: null,
        birth_lng: null,
        birth_tz: null,
        notes: '',
        tags: [],
      },
    });
  });

  it('requires a name', () => {
    expect(parseClientForm(form({ name: '   ' }))).toEqual({
      ok: false,
      errors: { name: 'nameRequired' },
    });
  });

  it('rejects a malformed email', () => {
    expect(parseClientForm(form({ name: 'Ana', email: 'ana@' }))).toEqual({
      ok: false,
      errors: { email: 'email' },
    });
  });

  it('stores "No sabe la hora" as null, never as midnight', () => {
    const result = parseClientForm(
      form({
        name: 'Ana',
        birth_date: '1990-04-12',
        birth_time: '00:00',
        birth_time_unknown: true,
      }),
    );
    expect(result.ok && result.fields.birth_time).toBeNull();
  });

  it('keeps a known birth time', () => {
    const result = parseClientForm(form({ name: 'Ana', birth_time: '14:30' }));
    expect(result.ok && result.fields.birth_time).toBe('14:30');
  });

  it('strips the @ from the Instagram handle', () => {
    const result = parseClientForm(form({ name: 'Ana', instagram: '@luna.ana' }));
    expect(result.ok && result.fields.instagram).toBe('luna.ana');
  });
});

describe('parseClientForm birth place', () => {
  const place = {
    name: 'Ana',
    birth_place_label: 'San Rafael, Escazú, San José',
    birth_lat: '9.9489',
    birth_lng: '-84.1389',
    birth_tz: 'America/Costa_Rica',
  };

  it('stores a picked city as numbers plus its timezone, without the manual flag', () => {
    const result = parseClientForm(form({ ...place, birth_place_manual: true }));
    expect(result.ok && result.fields).toMatchObject({
      birth_place_label: 'San Rafael, Escazú, San José',
      birth_lat: 9.9489,
      birth_lng: -84.1389,
      birth_tz: 'America/Costa_Rica',
    });
    expect(result.ok && result.fields).not.toHaveProperty('birth_place_manual');
  });

  it('accepts a comma as decimal separator', () => {
    const result = parseClientForm(form({ ...place, birth_lat: '9,93', birth_lng: '-84,08' }));
    expect(result.ok && [result.fields.birth_lat, result.fields.birth_lng]).toEqual([9.93, -84.08]);
  });

  it('keeps a place label without coordinates (older clients)', () => {
    const result = parseClientForm(form({ name: 'Ana', birth_place_label: 'Escazú' }));
    expect(result.ok && result.fields).toMatchObject({
      birth_place_label: 'Escazú',
      birth_lat: null,
      birth_lng: null,
      birth_tz: null,
    });
  });

  it.each([
    [{ birth_lat: '91' }, { birth_lat: 'lat' }],
    [{ birth_lat: 'norte' }, { birth_lat: 'lat' }],
    [{ birth_lng: '-180.5' }, { birth_lng: 'lng' }],
    [{ birth_tz: 'America/Ciudad_Inventada' }, { birth_tz: 'tz' }],
  ])('rejects out-of-range or unknown values: %o', (overrides, errors) => {
    expect(parseClientForm(form({ ...place, ...overrides }))).toEqual({ ok: false, errors });
  });

  it('requires latitude, longitude and timezone together', () => {
    expect(parseClientForm(form({ name: 'Ana', birth_lat: '9.93' }))).toEqual({
      ok: false,
      errors: { birth_lng: 'lng', birth_tz: 'tz' },
    });
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and duplicates', () => {
    expect(parseTags(' ansiedad, trabajo,, ansiedad ,cliente frecuente ')).toEqual([
      'ansiedad',
      'trabajo',
      'cliente frecuente',
    ]);
  });
});

describe('clientToForm', () => {
  it('checks "No sabe la hora" for a saved birth date without time', () => {
    const values = clientToForm({
      ...newClient({ birth_date: '1990-04-12', tags: ['a', 'b'] }),
      id: 'x',
      updated_at: '',
      deleted_at: null,
      server_version: null,
      device_id: 'd',
      pending: 0,
    });
    expect(values.birth_time_unknown).toBe(true);
    expect(values.tags).toBe('a, b');
  });

  it('turns saved coordinates into text, and missing ones into empty fields', () => {
    const saved = (overrides: Partial<Parameters<typeof newClient>[0]>) => ({
      ...newClient(overrides),
      id: 'x',
      updated_at: '',
      deleted_at: null,
      server_version: null,
      device_id: 'd',
      pending: 0 as const,
    });
    expect(
      clientToForm(
        saved({ birth_lat: 9.9339, birth_lng: -84.0833, birth_tz: 'America/Costa_Rica' }),
      ),
    ).toMatchObject({ birth_lat: '9.9339', birth_lng: '-84.0833', birth_tz: 'America/Costa_Rica' });
    expect(clientToForm(saved({ birth_place_label: 'Escazú' }))).toMatchObject({
      birth_place_label: 'Escazú',
      birth_lat: '',
      birth_lng: '',
      birth_tz: '',
      birth_place_manual: false,
    });
  });
});
