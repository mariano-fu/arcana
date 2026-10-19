import { formatMoney, formatMoneyInput, isMinorAmount, parseMoney, sumByCurrency } from '.';

const NBSP = ' ';

describe('isMinorAmount', () => {
  it('accepts safe integers only', () => {
    expect(isMinorAmount(0)).toBe(true);
    expect(isMinorAmount(1_500_000)).toBe(true);
    expect(isMinorAmount(-500)).toBe(true);
    expect(isMinorAmount(10.5)).toBe(false);
    expect(isMinorAmount(Number.NaN)).toBe(false);
    expect(isMinorAmount(2 ** 53)).toBe(false);
    expect(isMinorAmount('100')).toBe(false);
  });
});

describe('sumByCurrency', () => {
  it('keeps currencies apart and leaves out currencies with no items', () => {
    expect(
      sumByCurrency([
        { amount_minor: 1_000_000, currency: 'CRC' },
        { amount_minor: 4_000, currency: 'USD' },
        { amount_minor: 500_000, currency: 'CRC' },
      ]),
    ).toEqual({ CRC: 1_500_000, USD: 4_000 });
    expect(sumByCurrency([{ amount_minor: 4_000, currency: 'USD' }])).toEqual({ USD: 4_000 });
    expect(sumByCurrency([])).toEqual({});
  });

  it('rejects float amounts', () => {
    expect(() => sumByCurrency([{ amount_minor: 10.5, currency: 'CRC' }])).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('formats colones with es-CR grouping, dropping ,00 on whole amounts', () => {
    expect(formatMoney(1_500_000, 'CRC')).toBe(`₡15${NBSP}000`);
    expect(formatMoney(1_500_050, 'CRC')).toBe(`₡15${NBSP}000,50`);
    expect(formatMoney(123_456_700, 'CRC')).toBe(`₡1${NBSP}234${NBSP}567`);
    expect(formatMoney(0, 'CRC')).toBe('₡0');
  });

  it('formats dollars as US$ with cents', () => {
    expect(formatMoney(4_000, 'USD')).toBe('US$40,00');
    expect(formatMoney(4_050, 'USD')).toBe('US$40,50');
    expect(formatMoney(123_456, 'USD')).toBe(`US$1${NBSP}234,56`);
    expect(formatMoney(5, 'USD')).toBe('US$0,05');
  });

  it('formats negative amounts (saldo a favor)', () => {
    expect(formatMoney(-500_000, 'CRC')).toBe(`-₡5${NBSP}000`);
    expect(formatMoney(-1_000, 'USD')).toBe('-US$10,00');
  });

  it('rejects float amounts', () => {
    expect(() => formatMoney(15000.5, 'CRC')).toThrow(RangeError);
  });
});

describe('formatMoneyInput', () => {
  it('drops the symbol and round-trips through parseMoney', () => {
    expect(formatMoneyInput(1_500_000, 'CRC')).toBe(`15${NBSP}000`);
    expect(formatMoneyInput(4_050, 'USD')).toBe('40,50');
    for (const [amount, currency] of [
      [1_500_050, 'CRC'],
      [123_456, 'USD'],
    ] as const) {
      expect(parseMoney(formatMoneyInput(amount, currency))).toBe(amount);
    }
  });
});

describe('parseMoney', () => {
  it.each([
    ['15000', 1_500_000],
    ['15 000', 1_500_000],
    [`15${NBSP}000`, 1_500_000],
    ['₡15 000', 1_500_000],
    ['₡15 000,50', 1_500_050],
    ['15.000', 1_500_000],
    ['1.234.567', 123_456_700],
    ['1.234,5', 123_450],
    ['40', 4_000],
    ['40,5', 4_050],
    ['40.50', 4_050],
    ['US$40,00', 4_000],
    ['$ 40', 4_000],
    ['usd 40', 4_000],
    ['  0  ', 0],
    ['0,05', 5],
  ])('parses %j as %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '₡',
    'abc',
    '-500',
    '40,505',
    '1,2,3',
    '1.5,0',
    '15.00.0',
    '12a',
    '9'.repeat(20),
  ])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});
