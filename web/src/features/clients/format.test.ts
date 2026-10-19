import { formatDate, formatList, formatMoney } from './format';

describe('formatMoney', () => {
  it('formats colones and dollars in es-CR, decimals only when needed', () => {
    expect(formatMoney(4500000, 'CRC')).toBe('₡45 000');
    expect(formatMoney(2050, 'USD')).toBe('US$20,50');
  });
});

describe('formatDate', () => {
  it('formats a calendar date without shifting it by timezone', () => {
    expect(formatDate('1990-04-01')).toBe('1 de abril de 1990');
  });
});

describe('formatList', () => {
  it('joins with commas and "y"', () => {
    expect(formatList(['4 sesiones', '3 pagos'])).toBe('4 sesiones y 3 pagos');
  });
});
