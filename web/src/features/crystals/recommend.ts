// Crystal recommender: ranks crystals by the client's signs and the chosen intentions, and says
// why each one is recommended.
//
// Score = sign points (sun 2, moon 1, rising 1; placements add up, so sun and moon both in Leo
// give a Leo crystal 3) + 3 per chosen intention the crystal has. Each sign or intention counts
// once per crystal, even if her edits list it twice. Crystals scoring 0, hidden ones and
// tombstones are left out. Her edited and her own crystals are scored like any other row.
//
// Decisions marked "Provisional (T2.8 decision N)" await Mariano's confirmation; each is a named
// constant or a small branch so it is easy to change.

import type { TFunction } from 'i18next';

import type { ClientSigns } from '../../astro/clientSigns.ts';
import type { Crystal, IntentionTag } from '../../db/types.ts';
import { INTENTIONS, type IntentionKey } from '../../seed/crystals.ts';
import { zodiacSeed, type SignKey } from '../../seed/zodiac.ts';

export type Placement = 'sun' | 'moon' | 'rising';

export const SIGN_POINTS: Record<Placement, number> = { sun: 2, moon: 1, rising: 1 };
export const INTENTION_POINTS = 3;

/**
 * Provisional (T2.8 decision 1): on a cusp date, a crystal for either possible sun sign earns the
 * full sun points (once per crystal), with the reason marked "posible".
 */
export const CUSP_ALTERNATIVE_POINTS = SIGN_POINTS.sun;

export type Reason =
  | { kind: 'sign'; placement: Placement; sign: SignKey; possible: boolean }
  | { kind: 'intention'; key: string };

export interface Recommendation {
  crystal: Crystal;
  score: number;
  /** Signs first (sun, moon, rising), then intentions in the order they were chosen. */
  reasons: Reason[];
}

export interface RecommendInput {
  crystals: readonly Crystal[];
  signs: ClientSigns;
  /** Chosen intention tag keys. */
  intentions: readonly string[];
  /** Intention tag rows; a chosen key without a live row does not count. */
  tags: readonly IntentionTag[];
  /** No default: callers decide how many to show (provisional, T2.8 decision 3). */
  limit?: number;
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** Ranked recommendations, best first. */
export function recommendCrystals({
  crystals,
  signs,
  intentions,
  tags,
  limit,
}: RecommendInput): Recommendation[] {
  // Provisional (T2.8 decision 4): a deleted tag no longer counts, even if a crystal lists it.
  const liveTags = new Set(tags.filter((tag) => tag.deleted_at === null).map((tag) => tag.key));
  const chosen = [...new Set(intentions)].filter((key) => liveTags.has(key));

  const ranked: (Recommendation & { intentionMatches: number })[] = [];
  for (const crystal of crystals) {
    if (crystal.hidden || crystal.deleted_at !== null) continue;
    const crystalSigns = new Set<string>(crystal.signs);
    const crystalIntentions = new Set(crystal.intentions);

    let score = 0;
    const reasons: Reason[] = [];
    for (const match of signMatches(signs, crystalSigns)) {
      score += match.points;
      reasons.push(match.reason);
    }
    const matched = chosen.filter((key) => crystalIntentions.has(key));
    score += matched.length * INTENTION_POINTS;
    reasons.push(...matched.map((key): Reason => ({ kind: 'intention', key })));

    if (score > 0) ranked.push({ crystal, score, reasons, intentionMatches: matched.length });
  }

  // Provisional (T2.8 decision 5): ties go to more matched intentions, then Spanish
  // alphabetical order; the id keeps the order the same on every device.
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.intentionMatches - a.intentionMatches ||
      collator.compare(a.crystal.name, b.crystal.name) ||
      a.crystal.id.localeCompare(b.crystal.id),
  );
  return ranked.slice(0, limit).map(({ crystal, score, reasons }) => ({ crystal, score, reasons }));
}

function signMatches(
  signs: ClientSigns,
  crystalSigns: ReadonlySet<string>,
): { points: number; reason: Reason }[] {
  const matches: { points: number; reason: Reason }[] = [];
  const { sun } = signs;
  if (sun) {
    const possible = sun.alternative !== null;
    if (crystalSigns.has(sun.sign)) {
      matches.push({
        points: SIGN_POINTS.sun,
        reason: { kind: 'sign', placement: 'sun', sign: sun.sign, possible },
      });
    } else if (sun.alternative !== null && crystalSigns.has(sun.alternative)) {
      matches.push({
        points: CUSP_ALTERNATIVE_POINTS,
        reason: { kind: 'sign', placement: 'sun', sign: sun.alternative, possible },
      });
    }
  }
  for (const placement of ['moon', 'rising'] as const) {
    const sign = signs[placement];
    if (sign !== null && crystalSigns.has(sign)) {
      matches.push({
        points: SIGN_POINTS[placement],
        reason: { kind: 'sign', placement, sign, possible: false },
      });
    }
  }
  return matches;
}

const signNames = new Map(zodiacSeed.signs.map((sign) => [sign.key, sign.name]));
const seedIntentions = new Set<string>(INTENTIONS);

/** Her label for the tag, else the es.json label for a seed key, else the key itself. */
export function intentionLabel(key: string, tags: readonly IntentionTag[], t: TFunction): string {
  const label = tags.find((tag) => tag.key === key && tag.deleted_at === null)?.label;
  if (label) return label;
  return seedIntentions.has(key) ? t(`crystals.intention.${key as IntentionKey}`) : key;
}

/** "Sol en Leo · Luna en Leo · Intenciones: Calma, Protección". */
export function formatReasons(
  reasons: readonly Reason[],
  tags: readonly IntentionTag[],
  t: TFunction,
): string {
  const parts: string[] = [];
  const intentions: string[] = [];
  for (const reason of reasons) {
    if (reason.kind === 'intention') {
      intentions.push(intentionLabel(reason.key, tags, t));
      continue;
    }
    const sign = signNames.get(reason.sign) ?? reason.sign;
    const text = t(`crystals.reason.${reason.placement}`, { sign });
    parts.push(reason.possible ? t('crystals.reason.possible', { reason: text }) : text);
  }
  if (intentions.length > 0) {
    parts.push(
      t('crystals.reason.intentions', { count: intentions.length, list: intentions.join(', ') }),
    );
  }
  return parts.join(' · ');
}
