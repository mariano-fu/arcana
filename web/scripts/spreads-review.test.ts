// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { spreadsSeed } from '../src/seed/spreads.ts';
import { createReviewT } from './cards-review.ts';
import { renderLayout, renderSpreadsReview, REVIEW_DOC_PATH } from './spreads-review.ts';

function spread(key: string) {
  const found = spreadsSeed.spreads.find((s) => s.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

describe('spreads review document', () => {
  const rendered = renderSpreadsReview(spreadsSeed, createReviewT());

  it('has one section per spread and per position', () => {
    const positions = spreadsSeed.spreads.reduce((n, s) => n + s.positions.length, 0);
    expect(rendered.match(/^## /gm)).toHaveLength(spreadsSeed.spreads.length);
    expect(rendered.match(/^### /gm)).toHaveLength(positions);
    expect(rendered).toContain('`one-card` · 1 carta');
    expect(rendered).toContain('`celtic-cross` · 10 cartas');
    expect(rendered).toContain('### 7 · La persona consultante');
  });

  it('sketches the Cruz Celta with the challenge across the first card', () => {
    expect(renderLayout(spread('celtic-cross')).split('\n')).toEqual([
      '         5          10',
      '   4    1×2    6     9',
      '         3           8',
      '                     7',
    ]);
  });

  it('sketches the Herradura as an arch', () => {
    expect(renderLayout(spread('horseshoe')).split('\n')).toEqual([
      '                     4',
      '               3           5',
      '         2                       6',
      '   1                                   7',
    ]);
  });

  it('is up to date with spreads.json (run `npm run build:spreads-review`)', () => {
    expect(readFileSync(REVIEW_DOC_PATH, 'utf8')).toBe(rendered);
  });
});
