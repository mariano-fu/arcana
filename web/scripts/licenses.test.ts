// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectLicenses,
  headerComment,
  LICENSES_PATH,
  renderLicenses,
  type LicensesFile,
} from './licenses.ts';

let root: string;

function pkg(dir: string, json: object, files: Record<string, string> = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

function fixture() {
  root = mkdtempSync(join(tmpdir(), 'licenses-'));
  const nm = join(root, 'node_modules');
  pkg(root, {
    name: 'app',
    version: '1.0.0',
    dependencies: { alpha: '^1', '@types/alpha': '^1' },
    devDependencies: { devtool: '^1' },
  });
  pkg(
    join(nm, 'alpha'),
    { name: 'alpha', version: '1.0.0', license: 'MIT', dependencies: { beta: '^2' } },
    {
      LICENSE: 'MIT License\nCopyright (c) Alpha\n',
    },
  );
  // alpha needs beta 2, nested; the top-level beta 1 belongs to the Workbox-like extra root.
  pkg(
    join(nm, 'alpha', 'node_modules', 'beta'),
    { name: 'beta', version: '2.0.0', license: { type: 'ISC' } },
    {
      'LICENSE.md': 'ISC beta 2',
    },
  );
  pkg(
    join(nm, 'beta'),
    { name: 'beta', version: '1.0.0', license: 'Apache-2.0' },
    {
      LICENSE: 'Apache text',
      NOTICE: 'Beta notice',
    },
  );
  pkg(
    join(nm, 'devtool'),
    { name: 'devtool', version: '1.0.0', license: 'GPL-3.0' },
    { LICENSE: 'GPL' },
  );
  return nm;
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('collectLicenses', () => {
  it('walks runtime dependencies and extra roots, never dev or @types packages', () => {
    fixture();
    const { packages } = collectLicenses(root, ['beta']);
    expect(packages.map((p) => `${p.name}@${p.version} ${p.license}`)).toEqual([
      'alpha@1.0.0 MIT',
      'beta@1.0.0 Apache-2.0',
      'beta@2.0.0 ISC',
    ]);
    expect(packages[0]?.text).toBe('MIT License\nCopyright (c) Alpha');
    expect(packages[1]?.text).toBe('Apache text\n\nBeta notice');
  });

  it('fails when a package has no licence text or identifier', () => {
    const nm = fixture();
    rmSync(join(nm, 'alpha', 'LICENSE'));
    expect(() => collectLicenses(root, [])).toThrow('alpha: no LICENSE');

    writeFileSync(join(nm, 'alpha', 'LICENSE'), 'x');
    pkg(join(nm, 'alpha'), { name: 'alpha', version: '1.0.0' });
    expect(() => collectLicenses(root, [])).toThrow('alpha@1.0.0: no "license"');
  });

  it('fails when a dependency is not installed', () => {
    fixture();
    expect(() => collectLicenses(root, ['gamma'])).toThrow('gamma: not installed');
  });
});

describe('headerComment', () => {
  it('reads the opening block comment without its markers', () => {
    expect(headerComment('/**\n    @preserve\n\n    MIT License\n    Copyright X\n*/\ncode')).toBe(
      'MIT License\nCopyright X',
    );
    expect(headerComment('code /* late */')).toBeNull();
  });
});

describe('licenses.json', () => {
  it('is up to date with node_modules (run `npm run build:licenses`)', () => {
    const app = fileURLToPath(new URL('..', import.meta.url));
    expect(readFileSync(LICENSES_PATH, 'utf8')).toBe(renderLicenses(collectLicenses(app)));
  });

  it('carries the full MIT notice of each bundled package, incl. astronomy-engine', () => {
    const file = JSON.parse(readFileSync(LICENSES_PATH, 'utf8')) as LicensesFile;
    const names = file.packages.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['react', 'dexie', 'workbox-precaching']));
    expect(names).not.toContain('vite');
    const astronomy = file.packages.find((p) => p.name === 'astronomy-engine');
    expect(astronomy?.text).toContain('Copyright (c) 2019-2023 Don Cross');
    expect(astronomy?.text).toContain('Permission is hereby granted');
  });
});
