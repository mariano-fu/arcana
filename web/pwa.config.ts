import type { VitePWAOptions } from 'vite-plugin-pwa';

import es from './src/i18n/locales/es.json' with { type: 'json' };

export const BACKGROUND_COLOR = '#fafaf9';
// The status bar takes the theme color, so it matches the app background (T1.7).
// index.html's theme-color meta and the body background in src/index.css use the same value.
export const THEME_COLOR = BACKGROUND_COLOR;
/**
 * Workbox's default per-file precache limit, made explicit: larger files are skipped with only a
 * warning, so scripts/check-precache.ts fails the build if the city list chunk reaches it.
 */
export const MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;

// The manifest is static, so its Spanish copy is read from the es locale at
// build time instead of being duplicated here.
export const pwaOptions: Partial<VitePWAOptions> = {
  // T4.7 switches this to 'prompt' for the "Nueva versión disponible" toast.
  registerType: 'autoUpdate',
  includeManifestIcons: false,
  manifest: {
    name: es.app.name,
    short_name: es.app.name,
    description: es.app.description,
    lang: 'es-CR',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // Everything the shell needs is precached from our own origin; no
    // runtime caching of third-party resources (constitution §2). The plugin
    // adds manifest.webmanifest itself, and the glob already covers the icons.
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
  },
};
