import es from '../i18n/locales/es.json';
import { masculineWords } from '../test/gender-neutral';
import { healthClaims } from '../test/health-claims';
import {
  CHAKRAS,
  COLORS,
  crystalsFileSchema,
  crystalsSeed,
  INTENTIONS,
  type CrystalsFile,
  type SeedCrystal,
} from './crystals';
import raw from './crystals.es.json';
import { SIGN_KEYS } from './zodiac';

const clone = (): CrystalsFile => structuredClone(crystalsSeed);

function first(file: CrystalsFile): SeedCrystal {
  const crystal = file.crystals[0];
  if (!crystal) throw new Error('empty seed');
  return crystal;
}

/** Issue messages from parsing `file`; empty when it is valid. */
const issues = (file: unknown): string[] =>
  crystalsFileSchema.safeParse(file).error?.issues.map((i) => i.message) ?? [];

/** How many seed crystals list `value` in `field`. */
const countWith = (field: 'chakras' | 'signs' | 'intentions', value: string) =>
  crystalsSeed.crystals.filter((c) => (c[field] as string[]).includes(value)).length;

const texts = () => crystalsSeed.crystals.flatMap((c) => [c.description, c.care]);

describe('crystals seed', () => {
  it('passes the schema', () => {
    expect(issues(raw)).toEqual([]);
  });

  it('has about 50 crystals with unique keys and names', () => {
    expect(crystalsSeed.crystals.length).toBeGreaterThanOrEqual(45);
    expect(crystalsSeed.crystals.length).toBeLessThanOrEqual(55);
    const keys = crystalsSeed.crystals.map((c) => c.key);
    const names = crystalsSeed.crystals.map((c) => c.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every sign, chakra and intention enough crystals to recommend', () => {
    for (const sign of SIGN_KEYS) expect(countWith('signs', sign), sign).toBeGreaterThanOrEqual(3);
    for (const chakra of CHAKRAS)
      expect(countWith('chakras', chakra), chakra).toBeGreaterThanOrEqual(2);
    for (const intention of INTENTIONS)
      expect(countWith('intentions', intention), intention).toBeGreaterThanOrEqual(3);
  });

  it('has a Spanish label for every chakra, color and intention', () => {
    for (const c of CHAKRAS) expect(es.crystals.chakra[c]).toBeTruthy();
    for (const c of COLORS) expect(es.crystals.color[c]).toBeTruthy();
    for (const i of INTENTIONS) expect(es.crystals.intention[i]).toBeTruthy();
    expect(Object.keys(es.crystals.chakra)).toEqual([...CHAKRAS]);
    expect(es.crystals.chakra.solarPlexus).toBe('Plexo solar');
  });

  it('uses no masculine-only words about people', () => {
    const labels = Object.values(es.crystals.intention);
    expect([...texts(), ...labels].flatMap(masculineWords)).toEqual([]);
  });

  it('makes no health or medical claims', () => {
    const found = crystalsSeed.crystals.flatMap((c) =>
      [c.description, c.care].flatMap((t) => healthClaims(t).map((w) => `${c.key}: ${w}`)),
    );
    expect(found).toEqual([]);
    expect(Object.values(es.crystals.intention).flatMap(healthClaims)).toEqual([]);
  });

  it('frames descriptions as associations or traditional uses', () => {
    for (const { key, description } of crystalsSeed.crystals) {
      expect(description, key).toMatch(/se asocia|se le relaciona|tradicionalmente/i);
    }
  });

  it('rejects inventory fields', () => {
    for (const field of ['stock', 'price', 'quantity', 'price_minor']) {
      const file = clone();
      Object.assign(first(file), { [field]: 1 });
      expect(issues(file), field).not.toEqual([]);
    }
  });

  it('rejects unknown signs, chakras and intentions', () => {
    const file = clone();
    Object.assign(first(file), { signs: ['ophiuchus'] });
    expect(issues(file)).not.toEqual([]);
    const file2 = clone();
    Object.assign(first(file2), { chakras: ['soulStar'] });
    expect(issues(file2)).not.toEqual([]);
    const file3 = clone();
    Object.assign(first(file3), { intentions: ['anxiety'] });
    expect(issues(file3)).not.toEqual([]);
  });

  it('rejects duplicate keys, names and list entries', () => {
    const file = clone();
    const [a, b] = file.crystals;
    if (!a || !b) throw new Error('need two crystals');
    b.key = a.key;
    b.name = a.name;
    a.signs = ['leo', 'leo'];
    expect(issues(file)).toEqual(
      expect.arrayContaining([
        `duplicate key ${a.key}`,
        `duplicate name ${a.name}`,
        'duplicate entries',
      ]),
    );
  });
});
