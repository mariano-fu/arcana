// Looking for a new version of the app (T4.7). Browsers check on navigation and registration,
// but a home-screen app on iOS resumes from the background without either, so this also
// checks when the app comes back to the foreground.

/** T4.7 U4: foreground checks run at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Calls `registration.update()` when the app becomes visible, online and at least
 * UPDATE_CHECK_INTERVAL_MS after the last check (registration counts as one). Only looks:
 * a new version waits for her tap on "Recargar". Returns a function that stops watching.
 */
export function watchForUpdates(
  registration: { update(): Promise<unknown> },
  now: () => number = Date.now,
): () => void {
  let last = now();
  const onVisibility = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (now() - last < UPDATE_CHECK_INTERVAL_MS) return;
    last = now();
    registration.update().catch((error: unknown) => {
      console.error('Update check failed', error);
    });
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
