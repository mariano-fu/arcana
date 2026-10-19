import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BACKGROUND_COLOR, pwaOptions, THEME_COLOR } from './pwa.config.ts';
import es from './src/i18n/locales/es.json' with { type: 'json' };

const manifest = pwaOptions.manifest;
if (!manifest) throw new Error('pwaOptions.manifest is not set');
const icons = manifest.icons ?? [];

describe('PWA manifest', () => {
  it('uses the Spanish app name and description from the es locale', () => {
    expect(manifest.name).toBe(es.app.name);
    expect(manifest.short_name).toBe(es.app.name);
    expect(manifest.description).toBe(es.app.description);
    expect(manifest.lang).toBe('es-CR');
  });

  it('installs as a standalone app with theme colors', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe(THEME_COLOR);
    expect(manifest.background_color).toBe(BACKGROUND_COLOR);
  });

  it('has the 192px and 512px icons required for install, plus a maskable one', () => {
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});

describe('status bar color', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('matches the app background everywhere it is set', () => {
    expect(THEME_COLOR).toBe(BACKGROUND_COLOR);
    expect(read('./index.html')).toContain(
      `<meta name="theme-color" content="${BACKGROUND_COLOR}" />`,
    );
    expect(read('./src/index.css')).toContain(`background-color: ${BACKGROUND_COLOR};`);
  });
});

describe('PWA offline shell', () => {
  it('precaches the app shell and card images, and falls back to index.html for navigations', () => {
    expect(pwaOptions.workbox?.globPatterns).toEqual(['**/*.{js,css,html,svg,png,ico,webp}']);
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html');
  });

  it('never serves the app shell for API requests', () => {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    expect(denylist.some((pattern) => pattern.test('/api/sync/'))).toBe(true);
  });
});
