// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cardsSeed } from '../src/seed/cards.ts';
import { createReviewT, renderCardsReview, REVIEW_DOC_PATH } from './cards-review.ts';

describe('cards review document', () => {
  const rendered = renderCardsReview(cardsSeed, createReviewT());

  it('has one section per card, with suit and court names from es.json', () => {
    expect(rendered.match(/^### /gm)).toHaveLength(cardsSeed.cards.length);
    expect(rendered).toContain('### 0 · El Loco');
    expect(rendered).toContain('### Siete de Copas');
    expect(rendered).toContain('### Paje de Oros');
    expect(rendered).toContain('## Arcanos Menores: Oros');
  });

  it('is up to date with cards.es.json (run `npm run build:cards-review`)', () => {
    expect(readFileSync(REVIEW_DOC_PATH, 'utf8')).toBe(rendered);
  });
});
