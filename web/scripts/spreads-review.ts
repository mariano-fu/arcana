// Renders the spread seed as a Markdown review document (docs/review/spreads-es.md): one
// section per spread with a text sketch of its layout, then one section per position.

import type { TFunction } from 'i18next';

import type { SeedSpread, SpreadsFile } from '../src/seed/spreads.ts';

export const REVIEW_DOC_PATH = new URL('../../docs/review/spreads-es.md', import.meta.url);

const CELL_WIDTH = 6;

/** Text grid of position numbers; a crossed card shows as `1×2` (2 laid across 1). */
export function renderLayout(spread: SeedSpread): string {
  const cells = new Map<string, { upright?: number; rotated?: number }>();
  for (const { index, layout } of spread.positions) {
    const cell = `${String(layout.col)},${String(layout.row)}`;
    cells.set(cell, { ...cells.get(cell), [layout.rotated ? 'rotated' : 'upright']: index });
  }
  const cols = Math.max(...spread.positions.map((p) => p.layout.col)) + 1;
  const rows = Math.max(...spread.positions.map((p) => p.layout.row)) + 1;

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const cell = cells.get(`${String(col)},${String(row)}`);
      const label = [cell?.upright, cell?.rotated].filter((n) => n !== undefined).join('×');
      line += label.padStart(Math.ceil((CELL_WIDTH + label.length) / 2)).padEnd(CELL_WIDTH);
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

function spreadSection(spread: SeedSpread, t: TFunction): string {
  const corrections = [`**${t('spreads.review.corrections')}:**`, ''];
  return [
    `## ${spread.name}`,
    '',
    `\`${spread.key}\` · ${t('spreads.cardCount', { count: spread.positions.length })}`,
    '',
    spread.description,
    '',
    `**${t('spreads.review.layout')}:**`,
    '',
    '```',
    renderLayout(spread),
    '```',
    '',
    ...corrections,
    ...spread.positions.flatMap((position) => [
      `### ${String(position.index)} · ${position.name}`,
      '',
      position.meaning,
      '',
      ...corrections,
    ]),
  ].join('\n');
}

export function renderSpreadsReview(seed: SpreadsFile, t: TFunction): string {
  return [
    `# ${t('spreads.review.title')}`,
    '',
    t('spreads.review.intro'),
    '',
    `_${t('spreads.review.generated', { version: seed.version })}_`,
    '',
    ...seed.spreads.map((spread) => spreadSection(spread, t)),
  ].join('\n');
}
