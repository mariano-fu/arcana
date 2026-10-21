// Mutual exclusion across tabs. Sync runs and token refreshes take a Web Lock, so two tabs of
// the app never sync at once and never both spend the same (rotating) refresh token.

export interface Locks {
  /** Runs `callback` while holding the lock `name`; callers queue in order. */
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export const SYNC_LOCK = 'arcana:sync';
export const AUTH_LOCK = 'arcana:auth';

/** In-memory locks for one JS realm: the fallback without Web Locks, and the tests' "tabs". */
export function createLocalLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name, callback) {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(callback, callback);
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

let fallback: Locks | undefined;

/** `navigator.locks` (every browser the app supports), else an in-memory lock for this tab. */
export function defaultLocks(): Locks {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    const manager = navigator.locks;
    return { request: (name, callback) => manager.request(name, () => callback()) };
  }
  fallback ??= createLocalLocks();
  return fallback;
}
