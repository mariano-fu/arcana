import type { ClientSigns } from '../../astro';
import type { Crystal, IntentionTag } from '../../db/types';
import i18n from '../../i18n';
import { crystalsSeed, INTENTIONS } from '../../seed/crystals';
import { SIGN_KEYS, type SignKey } from '../../seed/zodiac';
import { masculineWords } from '../../test/gender-neutral';
import { healthClaims } from '../../test/health-claims';
import { formatReasons, recommendCrystals, type RecommendInput } from './recommend';

const t = i18n.t.bind(i18n);
const UPDATED = '2026-10-21T00:00:00.000Z';

let nextId = 0;
function crystal(fields: Partial<Crystal>): Crystal {
  nextId += 1;
  return {
    id: `crystal-${String(nextId).padStart(3, '0')}`,
    updated_at: UPDATED,
    deleted_at: null,
    server_version: null,
    device_id: 'device',
    pending: 0,
    seed_key: null,
    name: `Cristal ${String(nextId)}`,
    colors: ['white'],
    chakras: ['crown'],
    signs: ['aries'],
    intentions: ['calm'],
    description: 'Se asocia con la calma.',
    care: 'Limpiar con humo.',
    hidden: false,
    user_modified: false,
    ...fields,
  };
}

function tag(key: string, fields: Partial<IntentionTag> = {}): IntentionTag {
  return {
    id: `tag-${key}`,
    updated_at: UPDATED,
    deleted_at: null,
    server_version: null,
    device_id: 'device',
    pending: 0,
    key,
    label: null,
    ...fields,
  };
}

const SEED_TAGS = INTENTIONS.map((key) => tag(key));

const signs = (fields: Partial<ClientSigns>): ClientSigns => ({
  sun: null,
  moon: null,
  moonUncertain: false,
  rising: null,
  ...fields,
});
const sun = (sign: SignKey, alternative: SignKey | null = null) => ({ sign, alternative });

const recommend = (input: Partial<RecommendInput>) =>
  recommendCrystals({ crystals: [], signs: signs({}), intentions: [], tags: SEED_TAGS, ...input });

const scores = (input: Partial<RecommendInput>) =>
  recommend(input).map(({ crystal, score }) => [crystal.name, score]);

describe('recommendCrystals scoring', () => {
  it('gives 2 for the sun, 1 for the moon and 1 for the rising sign', () => {
    const all = crystal({ name: 'Todas', signs: ['leo', 'cancer', 'scorpio'] });
    const sunOnly = crystal({ name: 'Solar', signs: ['leo'] });
    const moonOnly = crystal({ name: 'Lunar', signs: ['cancer'] });
    expect(
      scores({
        crystals: [moonOnly, sunOnly, all],
        signs: signs({ sun: sun('leo'), moon: 'cancer', rising: 'scorpio' }),
      }),
    ).toEqual([
      ['Todas', 4],
      ['Solar', 2],
      ['Lunar', 1],
    ]);
  });

  it('adds placements in the same sign', () => {
    expect(
      scores({
        crystals: [crystal({ name: 'Leo', signs: ['leo'] })],
        signs: signs({ sun: sun('leo'), moon: 'leo', rising: 'leo' }),
      }),
    ).toEqual([['Leo', 4]]);
  });

  it('counts a sign listed twice once: sun and moon in it give 3, not 4 or 6', () => {
    const doubled = crystal({ name: 'Doble', signs: ['leo', 'leo'] });
    expect(scores({ crystals: [doubled], signs: signs({ sun: sun('leo'), moon: 'leo' }) })).toEqual(
      [['Doble', 3]],
    );
  });

  it('gives 3 per chosen intention, each counted once', () => {
    const both = crystal({ name: 'Ambas', intentions: ['calm', 'protection', 'calm'] });
    const one = crystal({ name: 'Una', intentions: ['protection'] });
    expect(scores({ crystals: [one, both], intentions: ['calm', 'protection', 'calm'] })).toEqual([
      ['Ambas', 6],
      ['Una', 3],
    ]);
  });

  it('adds signs and intentions', () => {
    expect(
      scores({
        crystals: [crystal({ name: 'Mixto', signs: ['leo'], intentions: ['joy'] })],
        signs: signs({ sun: sun('leo') }),
        intentions: ['joy'],
      }),
    ).toEqual([['Mixto', 5]]);
  });

  it('ignores an unknown or uncertain moon', () => {
    expect(
      scores({
        crystals: [crystal({ signs: ['cancer'] })],
        signs: signs({ sun: sun('leo'), moonUncertain: true }),
      }),
    ).toEqual([]);
  });
});

describe('recommendCrystals on a cusp date', () => {
  const cusp = signs({ sun: sun('scorpio', 'sagittarius') });

  it('gives the full sun points for either possible sign, marked possible', () => {
    const primary = crystal({ name: 'Primario', signs: ['scorpio'] });
    const alternative = crystal({ name: 'Alternativo', signs: ['sagittarius'] });
    const result = recommend({ crystals: [primary, alternative], signs: cusp });
    expect(result.map(({ crystal: c, score, reasons }) => [c.name, score, reasons])).toEqual([
      ['Alternativo', 2, [{ kind: 'sign', placement: 'sun', sign: 'sagittarius', possible: true }]],
      ['Primario', 2, [{ kind: 'sign', placement: 'sun', sign: 'scorpio', possible: true }]],
    ]);
  });

  it('counts the sun once when a crystal lists both possible signs', () => {
    const both = crystal({ name: 'Ambos', signs: ['scorpio', 'sagittarius'] });
    expect(recommend({ crystals: [both], signs: cusp })).toEqual([
      {
        crystal: both,
        score: 2,
        reasons: [{ kind: 'sign', placement: 'sun', sign: 'scorpio', possible: true }],
      },
    ]);
  });

  it('does not mark the sun possible on an ordinary date', () => {
    const [first] = recommend({
      crystals: [crystal({ signs: ['scorpio'] })],
      signs: signs({ sun: sun('scorpio') }),
    });
    expect(first?.reasons).toEqual([
      { kind: 'sign', placement: 'sun', sign: 'scorpio', possible: false },
    ]);
  });
});

describe('recommendCrystals filtering', () => {
  const leo = signs({ sun: sun('leo') });

  it('leaves out hidden crystals, tombstones and crystals scoring 0', () => {
    expect(
      scores({
        crystals: [
          crystal({ name: 'Oculto', signs: ['leo'], hidden: true }),
          crystal({ name: 'Borrado', signs: ['leo'], deleted_at: UPDATED }),
          crystal({ name: 'Ajeno', signs: ['aries'] }),
          crystal({ name: 'Visible', signs: ['leo'] }),
        ],
        signs: leo,
      }),
    ).toEqual([['Visible', 2]]);
  });

  it('returns nothing with no signs and no intentions', () => {
    expect(recommend({ crystals: crystalsSeed.crystals.map((c) => crystal(c)) })).toEqual([]);
  });

  it('scores her edits and her own crystals from their rows', () => {
    expect(
      scores({
        crystals: [
          crystal({ name: 'Editado', seed_key: 'amethyst', user_modified: true, signs: ['leo'] }),
          crystal({ name: 'Propio', seed_key: null, signs: ['leo'] }),
        ],
        signs: leo,
      }),
    ).toEqual([
      ['Editado', 2],
      ['Propio', 2],
    ]);
  });

  it('does not count a chosen intention whose tag was deleted or does not exist', () => {
    const tags = [tag('calm', { deleted_at: UPDATED }), tag('joy')];
    expect(
      scores({
        crystals: [crystal({ name: 'Calma', intentions: ['calm', 'focus', 'joy'] })],
        intentions: ['calm', 'focus', 'joy'],
        tags,
      }),
    ).toEqual([['Calma', 3]]);
  });
});

describe('recommendCrystals order', () => {
  it('breaks ties by matched intentions, then Spanish alphabetical order, then id', () => {
    const bySigns = crystal({ name: 'Ágata', signs: ['leo'], intentions: [] });
    const byIntention = crystal({ name: 'Zafiro', signs: [], intentions: ['calm'] });
    const amatista = crystal({ name: 'Amatista', signs: ['leo'], intentions: [] });
    const twinB = crystal({ id: 'b', name: 'Cuarzo', signs: ['leo'], intentions: [] });
    const twinA = crystal({ id: 'a', name: 'cuarzo', signs: ['leo'], intentions: [] });
    expect(
      recommend({
        crystals: [twinB, amatista, twinA, bySigns, byIntention],
        signs: signs({ sun: sun('leo'), moon: 'leo' }),
        intentions: ['calm'],
      }).map(({ crystal: c }) => c.id),
    ).toEqual([byIntention.id, bySigns.id, amatista.id, 'a', 'b']);
  });

  it('returns everything ranked unless a limit is given', () => {
    const crystals = ['A', 'B', 'C'].map((name) => crystal({ name, signs: ['leo'] }));
    const leo = signs({ sun: sun('leo') });
    expect(scores({ crystals, signs: leo })).toHaveLength(3);
    expect(scores({ crystals, signs: leo, limit: 2 })).toEqual([
      ['A', 2],
      ['B', 2],
    ]);
  });
});

describe('formatReasons', () => {
  it('lists signs, then intentions, in Spanish', () => {
    const [first] = recommend({
      crystals: [crystal({ signs: ['leo', 'scorpio'], intentions: ['calm', 'protection'] })],
      signs: signs({ sun: sun('leo'), moon: 'leo', rising: 'scorpio' }),
      intentions: ['protection', 'calm'],
    });
    expect(formatReasons(first?.reasons ?? [], SEED_TAGS, t)).toBe(
      'Sol en Leo · Luna en Leo · Ascendente en Escorpio · Intenciones: Protección, Calma',
    );
  });

  it('marks a cusp sun as possible and uses the singular for one intention', () => {
    expect(
      formatReasons(
        [
          { kind: 'sign', placement: 'sun', sign: 'sagittarius', possible: true },
          { kind: 'intention', key: 'joy' },
        ],
        SEED_TAGS,
        t,
      ),
    ).toBe('Sol en Sagitario (posible: fecha en cúspide) · Intención: Alegría');
  });

  it('uses her label for a renamed seed tag and for her own tag', () => {
    const tags = [tag('calm', { label: 'Paz interior' }), tag('own-tag', { label: 'Viajes' })];
    expect(
      formatReasons(
        [
          { kind: 'intention', key: 'calm' },
          { kind: 'intention', key: 'own-tag' },
        ],
        tags,
        t,
      ),
    ).toBe('Intenciones: Paz interior, Viajes');
  });
});

describe('recommendCrystals with the bundled crystals', () => {
  const crystals = crystalsSeed.crystals.map((c) => crystal({ ...c, seed_key: c.key }));

  it.each(SIGN_KEYS)('recommends at least 3 crystals for a %s sun alone', (sign) => {
    expect(recommend({ crystals, signs: signs({ sun: sun(sign) }) }).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('words every possible reason without health claims or gendered words', () => {
    const texts = SIGN_KEYS.flatMap((sign, i) => {
      const alternative = SIGN_KEYS[(i + 1) % SIGN_KEYS.length] ?? null;
      return recommend({
        crystals,
        signs: signs({ sun: sun(sign, alternative), moon: sign, rising: sign }),
        intentions: INTENTIONS,
      }).map(({ reasons }) => formatReasons(reasons, SEED_TAGS, t));
    });
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(healthClaims(text), text).toEqual([]);
      expect(masculineWords(text), text).toEqual([]);
    }
  });
});
