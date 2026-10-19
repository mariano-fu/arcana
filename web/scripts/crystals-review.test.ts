// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { crystalsSeed, INTENTIONS } from '../src/seed/crystals.ts';
import { zodiacSeed } from '../src/seed/zodiac.ts';
import { createReviewT } from './cards-review.ts';
import { renderCrystalsReview, REVIEW_DOC_PATH } from './crystals-review.ts';

describe('crystals review document', () => {
  const rendered = renderCrystalsReview(crystalsSeed, zodiacSeed, createReviewT());

  it('has an intentions section and one section per crystal', () => {
    expect(rendered.match(/^## /gm)).toHaveLength(crystalsSeed.crystals.length + 1);
    expect(rendered).toContain('## Intenciones');
    expect(rendered.match(/^- .+ \(`\w+`, \d+\)$/gm)).toHaveLength(INTENTIONS.length);
    expect(rendered).toContain('- Limpieza energética (`energyCleansing`, ');
  });

  it('resolves labels and sign names in Spanish', () => {
    expect(rendered).toContain('## Amatista\n\n`amethyst`');
    expect(rendered).toContain('**Chakras:** Corona, Tercer ojo');
    expect(rendered).toContain('**Signos:** Piscis, Acuario, Virgo, Capricornio');
    expect(rendered).toContain('**Intenciones:** Calma, Descanso, Intuición, Conexión espiritual');
    expect(rendered).not.toMatch(/crystals\.(color|chakra|intention|field)\./);
  });

  it('is up to date with crystals.es.json (run `npm run build:crystals-review`)', () => {
    expect(readFileSync(REVIEW_DOC_PATH, 'utf8')).toBe(rendered);
  });
});
