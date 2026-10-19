import {
  defaultSessionFields,
  fromLocalInput,
  parsePriceInput,
  parseSessionRouteState,
  priceToInput,
  sameSessionFields,
  toLocalInput,
} from './form';

describe('datetime-local conversion', () => {
  it('round-trips a timestamp through the device timezone', () => {
    const input = toLocalInput('2026-10-10T15:30:00.000Z');
    expect(input).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(input)).toBe('2026-10-10T15:30:00.000Z');
  });

  it('rejects empty and malformed values', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('2026-10-10')).toBeNull();
    expect(fromLocalInput('2026-13-45T99:99')).toBeNull();
  });
});

describe('price input', () => {
  it('shows a stored price without the symbol, in a form parsePriceInput reads back', () => {
    expect(priceToInput(null, 'CRC')).toBe('');
    for (const [minor, currency] of [
      [1500000, 'CRC'],
      [1500050, 'CRC'],
      [4050, 'USD'],
    ] as const) {
      const input = priceToInput(minor, currency);
      expect(input).not.toMatch(/₡|US\$/);
      expect(parsePriceInput(input)).toBe(minor);
    }
  });

  it('reads empty as no price and flags invalid input', () => {
    expect(parsePriceInput('  ')).toBeNull();
    expect(parsePriceInput('15 000')).toBe(1500000);
    expect(parsePriceInput('₡15.000')).toBe(1500000);
    expect(parsePriceInput('40,50')).toBe(4050);
    expect(parsePriceInput('abc')).toBeUndefined();
    expect(parsePriceInput('-5')).toBeUndefined();
  });
});

describe('sameSessionFields', () => {
  it('compares every editable field', () => {
    const base = defaultSessionFields('2026-10-10T15:00:00.000Z');
    expect(sameSessionFields(base, { ...base })).toBe(true);
    expect(sameSessionFields(base, { ...base, notes: 'x' })).toBe(false);
    expect(sameSessionFields(base, { ...base, price_minor: 0 })).toBe(false);
    expect(sameSessionFields(base, { ...base, follow_up_date: '2026-11-10' })).toBe(false);
  });
});

describe('parseSessionRouteState', () => {
  it('accepts the state set by "Nueva sesión" and rejects anything else', () => {
    expect(parseSessionRouteState({ unarchived: true })).toEqual({ unarchived: true });
    expect(parseSessionRouteState(null)).toBeNull();
    expect(parseSessionRouteState({ unarchived: 'yes' })).toBeNull();
  });
});
