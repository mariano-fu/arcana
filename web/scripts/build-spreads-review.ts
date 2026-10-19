// Regenerates docs/review/spreads-es.md from src/seed/spreads.json.
// Usage: npm run build:spreads-review

import { mkdir, writeFile } from 'node:fs/promises';

import { spreadsSeed } from '../src/seed/spreads.ts';
import { createReviewT } from './cards-review.ts';
import { renderSpreadsReview, REVIEW_DOC_PATH } from './spreads-review.ts';

await mkdir(new URL('.', REVIEW_DOC_PATH), { recursive: true });
await writeFile(REVIEW_DOC_PATH, renderSpreadsReview(spreadsSeed, createReviewT()));
console.log(`Wrote ${REVIEW_DOC_PATH.pathname}`);
