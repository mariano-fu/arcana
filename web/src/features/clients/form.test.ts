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
});
