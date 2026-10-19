import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import './i18n';
import './index.css';
// Pulls every card image into the build so the service worker precaches it (T1.5b).
import './seed/images/card-images.ts';
import App from './App.tsx';
import { db } from './db';
import { loadSeed } from './seed/loader.ts';

// Local and quick; render doesn't wait for it, and the next start retries a failed load.
loadSeed(db).catch((error: unknown) => {
  console.error('Seed load failed', error);
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerSW({ immediate: true });
