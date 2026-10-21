import { formatPosition, signName, splitPosition } from './format';
import { signForLongitude } from './sunSign';

describe('splitPosition', () => {
  it.each([
    [0, 'aries', 0, 0],
    [29.9999, 'aries', 29, 59],
    [29.99999999999, 'aries', 29, 59],
    // So close to 30 that signForLongitude's normalisation lands on 30: Taurus, never 30°00′.
    [30 - 2 ** -48, 'taurus', 0, 0],
    [30, 'taurus', 0, 0],
    [59.99999, 'taurus', 29, 59],
    [359.99999, 'pisces', 29, 59],
    [360, 'aries', 0, 0],
    [-0.5, 'pisces', 29, 30],
    [15.5, 'aries', 15, 30],
  ] as const)('%d° is %s %d°%d′', (longitude, sign, degrees, minutes) => {
    expect(splitPosition(longitude)).toEqual({ sign, degrees, minutes });
  });

  it('floors instead of rounding', () => {
    // 29°42.79′: rounding would say 29°43′.
    expect(splitPosition(89.713142)).toEqual({ sign: 'gemini', degrees: 29, minutes: 42 });
    expect(splitPosition(179.683262)).toEqual({ sign: 'virgo', degrees: 29, minutes: 40 });
  });

  it('always names the sign signForLongitude gives, with at most 29°59′', () => {
    for (let longitude = -720; longitude <= 720; longitude += 0.0137) {
      for (const x of [longitude, Math.round(longitude / 30) * 30 - 1e-12]) {
        const split = splitPosition(x);
        expect(split.sign).toBe(signForLongitude(x));
        expect(split.degrees * 60 + split.minutes).toBeLessThanOrEqual(30 * 60 - 1);
      }
    }
  });

  it('rejects a non-finite longitude', () => {
    expect(() => splitPosition(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatPosition', () => {
  it('writes degrees, two-digit minutes and the Spanish sign name', () => {
    expect(formatPosition(179.683262)).toBe('29°40′ Virgo');
    expect(formatPosition(89.713142)).toBe('29°42′ Géminis');
    expect(formatPosition(30.05)).toBe('0°03′ Tauro');
    expect(signName('scorpio')).toBe('Escorpio');
  });
});
