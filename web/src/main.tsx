import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import './i18n';
import './index.css';
// Pulls every card image into the build so the service worker precaches it (T1.5b).
import './seed/images/card-images.ts';
import App from './App.tsx';
import { db } from './db';
import { sweepFreshSessions } from './features/sessions/actions.ts';
import { sessionIdFromPath } from './features/sessions/leave.ts';
import { loadSeed } from './seed/loader.ts';
import { startSyncTriggers, syncEngine } from './sync';

// Local and quick; render doesn't wait for it, and the next start retries a failed load.
loadSeed(db).catch((error: unknown) => {
  console.error('Seed load failed', error);
});

// A session created and left untouched before the app was closed was a mistaken tap. The page
// the app opens on is skipped: leaving it handles that session.
sweepFreshSessions(db, { except: sessionIdFromPath(window.location.pathname) }).catch(
  (error: unknown) => {
    console.error('Fresh session sweep failed', error);
  },
);

// Open, foreground, online, every 5 min while visible, and after local edits (sync/triggers.ts).
startSyncTriggers(syncEngine, db);

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerSW({ immediate: true });
