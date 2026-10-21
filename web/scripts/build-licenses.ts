// Regenerates src/features/settings/licenses.json from node_modules (npm run build:licenses).
// Run it after changing runtime dependencies; the build and a test fail while it is stale.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { collectLicenses, LICENSES_PATH, renderLicenses } from './licenses.ts';

const file = collectLicenses(fileURLToPath(new URL('..', import.meta.url)));
writeFileSync(LICENSES_PATH, renderLicenses(file));
console.log(`${String(file.packages.length)} packages written to ${fileURLToPath(LICENSES_PATH)}`);
