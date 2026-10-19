import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { db } from '../../db';
import { discardIfUntouched } from './actions';

/**
 * Pending-save flushers of session pages, kept past unmount so leaving can wait for the last
 * autosave before checking whether the session was touched.
 */
const flushers = new Map<string, () => Promise<void>>();

export function registerSessionFlush(sessionId: string, flush: () => Promise<void>): void {
  flushers.set(sessionId, flush);
}

/** `/sessions/:id` → id; null for any other path. */
export function sessionIdFromPath(pathname: string): string | null {
  return /^\/sessions\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/**
 * Discards a just-created, untouched session when the route changes away from its page.
 * Runs on navigation, not on unmount, so StrictMode's simulated unmount can't trigger it.
 * Mount once, in a component that outlives the session page (the app layout).
 */
export function useDiscardSessionOnLeave(): void {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    const left = sessionIdFromPath(previous.current);
    previous.current = pathname;
    if (left === null || sessionIdFromPath(pathname) === left) return;

    const flush = flushers.get(left);
    flushers.delete(left);
    void (flush ?? (() => Promise.resolve()))().then(() => discardIfUntouched(db, left));
  }, [pathname]);
}
