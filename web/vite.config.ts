import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import { pwaOptions } from './pwa.config.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  // Same origin as in production, where Caddy proxies /api to the API.
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
