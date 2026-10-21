import i18n from '../../i18n';
import { useTimeZone } from '../../test/time-zone';
import {
  COMMON_TIME_ZONES,
  formatUtcOffset,
  MAX_TIME_ZONE_RESULTS,
  searchTimeZones,
  timeZoneLabel,
  timeZoneOptions,
} from './timeZones';

const t = i18n.t.bind(i18n);
const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

describe('formatUtcOffset', () => {
  it('writes whole and half hours with a real minus sign', () => {
    expect(formatUtcOffset(-360)).toBe('UTC−6');
    expect(formatUtcOffset(60)).toBe('UTC+1');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-570)).toBe('UTC−9:30');
    expect(formatUtcOffset(0)).toBe('UTC');
  });
});

describe('timeZoneLabel', () => {
  it("names common zones in Spanish with today's offset, marked as today's", () => {
    expect(timeZoneLabel('America/Costa_Rica', t, JANUARY)).toBe(
      'Costa Rica (San José) · hoy UTC−6',
    );
    expect(timeZoneLabel('Europe/Madrid', t, JANUARY)).toBe(
      'España, península (Madrid) · hoy UTC+1',
    );
    expect(timeZoneLabel('Europe/Madrid', t, JULY)).toBe('España, península (Madrid) · hoy UTC+2');
  });

  it('labels other zones by city and Spanish zone name', () => {
    expect(timeZoneLabel('America/Argentina/Buenos_Aires', t, JANUARY)).toMatch(
      /^Buenos Aires — hora .*Argentina · hoy UTC−3$/,
    );
    expect(timeZoneLabel('Asia/Kolkata', t, JANUARY)).toMatch(/^Kolkata — .* · hoy UTC\+5:30$/);
  });

  it('leaves an unknown saved zone as it is', () => {
    expect(timeZoneLabel('Mars/Olympus', t, JANUARY)).toBe('Mars/Olympus');
  });
});

describe('timeZoneOptions and searchTimeZones', () => {
  useTimeZone('UTC');
  const options = timeZoneOptions(t, null, JANUARY);

  it('lists the common zones first, in order, then the rest by label', () => {
    expect(options.slice(0, COMMON_TIME_ZONES.length).map((o) => o.id)).toEqual(
      COMMON_TIME_ZONES.map(([id]) => id),
    );
    const rest = options.slice(COMMON_TIME_ZONES.length).map((o) => o.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'es')));
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  });

  it('suggests the common zones for an empty query', () => {
    expect(searchTimeZones(options, '  ').map((o) => o.id)).toEqual(
      COMMON_TIME_ZONES.map(([id]) => id),
    );
  });

  it('matches Spanish labels and IANA names, ignoring case and accents', () => {
    const ids = (query: string) => searchTimeZones(options, query).map((o) => o.id);
    expect(ids('nueva york')).toEqual(['America/New_York']);
    expect(ids('NEW_YORK')).toEqual(['America/New_York']);
    expect(ids('panama')).toContain('America/Panama');
    expect(ids('los angeles')).toContain('America/Los_Angeles');
    expect(ids('canarias')).toEqual(['Atlantic/Canary']);
    // The browser lists one Buenos Aires zone (its ICU may use the older, shorter name).
    expect(ids('buenos aires')).toEqual([
      expect.stringMatching(/^America\/(Argentina\/)?Buenos_Aires$/),
    ]);
    expect(ids('zzzz')).toEqual([]);
    expect(searchTimeZones(options, 'america')).toHaveLength(MAX_TIME_ZONE_RESULTS);
  });

  it('keeps a saved zone the browser does not list', () => {
    const withExtra = timeZoneOptions(t, 'Mars/Olympus', JANUARY);
    expect(searchTimeZones(withExtra, 'olympus').map((o) => o.label)).toEqual(['Mars/Olympus']);
  });
});
