import { toUtc } from '.';

const CR = 'America/Costa_Rica';
const SAO_PAULO = 'America/Sao_Paulo';

describe('toUtc in Costa Rica', () => {
  it('uses UTC−6 outside DST', () => {
    expect(toUtc('2000-06-15', '14:00', CR)).toEqual({
      utc: new Date('2000-06-15T20:00:00Z'),
      timeKnown: true,
      offsetMinutes: -360,
      adjusted: 'none',
    });
  });

  // Costa Rica observed DST (UTC−5) only in 1979, 1980, 1991 and 1992 (tz database).
  it.each([
    ['1979-04-10', '1979-04-10T15:00:00Z'],
    ['1980-03-15', '1980-03-15T15:00:00Z'],
    ['1991-05-20', '1991-05-20T15:00:00Z'],
    ['1992-02-10', '1992-02-10T15:00:00Z'],
  ])('uses UTC−5 during DST on %s', (date, expected) => {
    const result = toUtc(date, '10:00', CR);
    expect(result.utc).toEqual(new Date(expected));
    expect(result.offsetMinutes).toBe(-300);
    expect(result.adjusted).toBe('none');
  });

  it('applies the rules of the date, not of a nearby DST year', () => {
    // Mid-February: DST in 1992, standard time in 1993.
    expect(toUtc('1992-02-10', '10:00', CR).offsetMinutes).toBe(-300);
    expect(toUtc('1993-02-10', '10:00', CR).offsetMinutes).toBe(-360);
  });

  it('shifts a time inside the 1979 spring-forward gap forward and flags it', () => {
    // 1979-02-25 00:00 CST jumped to 01:00 CDT, so 00:30 never existed.
    expect(toUtc('1979-02-25', '00:30', CR)).toEqual({
      utc: new Date('1979-02-25T06:30:00Z'), // 01:30 CDT
      timeKnown: true,
      offsetMinutes: -300,
      adjusted: 'gap',
    });
  });

  it('uses the earlier instant for a time repeated at the 1979 fall-back and flags it', () => {
    // 1979-06-03 00:00 CDT went back to 1979-06-02 23:00 CST, so 23:30 happened twice.
    expect(toUtc('1979-06-02', '23:30', CR)).toEqual({
      utc: new Date('1979-06-03T04:30:00Z'), // 23:30 CDT
      timeKnown: true,
      offsetMinutes: -300,
      adjusted: 'ambiguous',
    });
  });

  it('does not flag times just outside the 1979 transitions', () => {
    expect(toUtc('1979-02-25', '01:00', CR).adjusted).toBe('none');
    expect(toUtc('1979-02-24', '23:59', CR).adjusted).toBe('none');
    expect(toUtc('1979-06-02', '22:59', CR).adjusted).toBe('none');
    expect(toUtc('1979-06-03', '00:00', CR).adjusted).toBe('none');
  });
});

describe('toUtc in the Southern hemisphere (São Paulo)', () => {
  it('uses summer time (UTC−2) in January 2018', () => {
    const result = toUtc('2018-01-15', '12:00', SAO_PAULO);
    expect(result.utc).toEqual(new Date('2018-01-15T14:00:00Z'));
    expect(result.offsetMinutes).toBe(-120);
  });

  it('uses standard time (UTC−3) in July 2018', () => {
    expect(toUtc('2018-07-15', '12:00', SAO_PAULO).utc).toEqual(new Date('2018-07-15T15:00:00Z'));
  });

  it('uses UTC−3 in January 2020, after Brazil abolished DST', () => {
    const result = toUtc('2020-01-15', '12:00', SAO_PAULO);
    expect(result.utc).toEqual(new Date('2020-01-15T15:00:00Z'));
    expect(result.offsetMinutes).toBe(-180);
  });
});

describe('toUtc with an unknown time', () => {
  it('uses 12:00 local and marks timeKnown false', () => {
    expect(toUtc('1991-05-20', null, CR)).toEqual({
      utc: new Date('1991-05-20T17:00:00Z'),
      timeKnown: false,
      offsetMinutes: -300,
      adjusted: 'none',
    });
  });
});

describe('toUtc input validation', () => {
  it.each(['1990-02-30', '1990-2-03', '', '1990-02-03T00:00'])('rejects date "%s"', (date) => {
    expect(() => toUtc(date, '10:00', CR)).toThrow(RangeError);
  });

  it.each(['24:00', '10:60', '9:30', '10:00:00', ''])('rejects time "%s"', (time) => {
    expect(() => toUtc('1990-02-03', time, CR)).toThrow(RangeError);
  });

  it.each(['Mars/Olympus_Mons', '', 'UTC+25'])('rejects timezone "%s"', (tz) => {
    expect(() => toUtc('1990-02-03', '10:00', tz)).toThrow(RangeError);
  });
});
