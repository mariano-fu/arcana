// Regenerates docs/review/cards-es.md from src/seed/cards.es.json.
// Usage: npm run build:cards-review

import { mkdir, writeFile } from 'node:fs/promises';

import { cardsSeed } from '../src/seed/cards.ts';
import { createReviewT, renderCardsReview, REVIEW_DOC_PATH } from './cards-review.ts';

await mkdir(new URL('.', REVIEW_DOC_PATH), { recursive: true });
await writeFile(REVIEW_DOC_PATH, renderCardsReview(cardsSeed, createReviewT()));
console.log(`Wrote ${REVIEW_DOC_PATH.pathname}`);
