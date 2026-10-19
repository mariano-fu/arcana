import type { VitePWAOptions } from 'vite-plugin-pwa';

import es from './src/i18n/locales/es.json' with { type: 'json' };

export const THEME_COLOR = '#1c1917';
export const BACKGROUND_COLOR = '#fafaf9';

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
  },
};
