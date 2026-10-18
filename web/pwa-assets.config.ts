import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Regenerate the PNG icons in public/ with `npm run generate-pwa-assets`
// after changing public/icon.svg.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#1c1917' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#1c1917' } },
  },
  images: ['public/icon.svg'],
});
