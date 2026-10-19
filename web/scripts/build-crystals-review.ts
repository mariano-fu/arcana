// Regenerates docs/review/crystals-es.md from src/seed/crystals.es.json.
// Usage: npm run build:crystals-review

import { mkdir, writeFile } from 'node:fs/promises';

import { crystalsSeed } from '../src/seed/crystals.ts';
import { zodiacSeed } from '../src/seed/zodiac.ts';
import { createReviewT } from './cards-review.ts';
import { renderCrystalsReview, REVIEW_DOC_PATH } from './crystals-review.ts';

await mkdir(new URL('.', REVIEW_DOC_PATH), { recursive: true });
await writeFile(REVIEW_DOC_PATH, renderCrystalsReview(crystalsSeed, zodiacSeed, createReviewT()));
console.log(`Wrote ${REVIEW_DOC_PATH.pathname}`);
