// Fails the build if src/features/settings/licenses.json no longer matches the installed
// runtime dependencies. Fix with `npm run build:licenses`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectLicenses, LICENSES_PATH, renderLicenses } from './licenses.ts';

const expected = renderLicenses(collectLicenses(fileURLToPath(new URL('..', import.meta.url))));
if (readFileSync(LICENSES_PATH, 'utf8') !== expected) {
  console.error('error: licenses.json is stale; run `npm run build:licenses` and commit it');
  process.exit(1);
}
