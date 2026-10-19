// Renders the crystal seed as a Markdown review document (docs/review/crystals-es.md): the
// intention tags first, then one section per crystal with its Spanish labels resolved.

import type { TFunction } from 'i18next';

import { INTENTIONS, type CrystalsFile, type SeedCrystal } from '../src/seed/crystals.ts';
import type { ZodiacFile } from '../src/seed/zodiac.ts';

export const REVIEW_DOC_PATH = new URL('../../docs/review/crystals-es.md', import.meta.url);

function intentionsSection(seed: CrystalsFile, t: TFunction): string {
  const count = (key: string) =>
    seed.crystals.filter((c) => c.intentions.some((i) => i === key)).length;
  return [
    `## ${t('crystals.review.intentions')}`,
    '',
    t('crystals.review.intentionsIntro'),
    '',
    ...INTENTIONS.map(
      (key) => `- ${t(`crystals.intention.${key}`)} (\`${key}\`, ${String(count(key))})`,
    ),
    '',
    `**${t('crystals.review.corrections')}:**`,
    '',
  ].join('\n');
}

function crystalSection(crystal: SeedCrystal, zodiac: ZodiacFile, t: TFunction): string {
  const signName = (key: string) => zodiac.signs.find((s) => s.key === key)?.name ?? key;
  const field = (name: string, values: string[]) =>
    `**${t(`crystals.field.${name}`)}:** ${values.join(', ')}`;
  return [
    `## ${crystal.name}`,
    '',
    `\`${crystal.key}\``,
    '',
    field(
      'colors',
      crystal.colors.map((c) => t(`crystals.color.${c}`)),
    ),
    '',
    field(
      'chakras',
      crystal.chakras.map((c) => t(`crystals.chakra.${c}`)),
    ),
    '',
    field('signs', crystal.signs.map(signName)),
    '',
    field(
      'intentions',
      crystal.intentions.map((i) => t(`crystals.intention.${i}`)),
    ),
    '',
    crystal.description,
    '',
    `**${t('crystals.field.care')}:** ${crystal.care}`,
    '',
    `**${t('crystals.review.corrections')}:**`,
    '',
  ].join('\n');
}

export function renderCrystalsReview(seed: CrystalsFile, zodiac: ZodiacFile, t: TFunction): string {
  return [
    `# ${t('crystals.review.title')}`,
    '',
    t('crystals.review.intro'),
    '',
    `_${t('crystals.review.generated', { version: seed.version })}_`,
    '',
    intentionsSection(seed, t),
    ...seed.crystals.map((crystal) => crystalSection(crystal, zodiac, t)),
  ].join('\n');
}
