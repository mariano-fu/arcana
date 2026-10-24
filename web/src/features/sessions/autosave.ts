import { useEffect, useMemo } from 'react';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface Autosave<P extends object> {
  /** Merges the patch into what's waiting and saves it after `delay` ms without new changes. */
  schedule(patch: P): void;
  /** Forgets waiting (unsaved) changes to these fields, e.g. when a field turns invalid. */
  drop(...keys: (keyof P)[]): void;
  /** Saves whatever is waiting now and resolves once every save so far has finished. */
  flush(): Promise<void>;
  /** The last save failed and none has succeeded since, so her latest text may not be stored. */
  readonly failed: boolean;
}

/**
 * Debounced, flushable saver. Patches are merged, so the last value per field wins, and saves
 * run one at a time in order, so an older write can never land after a newer one.
 */
export function createAutosave<P extends object>(
  save: (patch: P) => Promise<unknown>,
  {
    delay = 600,
    onState,
  }: { delay?: number; onState?: ((state: AutosaveState) => void) | undefined } = {},
): Autosave<P> {
  let waiting: P | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let failed = false;

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    const patch = waiting;
    waiting = null;
    if (patch !== null) {
      onState?.('saving');
      chain = chain.then(() =>
        save(patch).then(
          () => {
            failed = false;
            if (waiting === null && timer === undefined) onState?.('saved');
          },
          (error: unknown) => {
            failed = true;
            console.error('Autosave failed', error);
            onState?.('error');
          },
        ),
      );
    }
    return chain;
  }

  return {
    schedule(patch) {
      waiting = { ...waiting, ...patch };
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    drop(...keys) {
      if (waiting === null) return;
      const rest = Object.fromEntries(
        Object.entries(waiting).filter(([key]) => !keys.includes(key as keyof P)),
      ) as P;
      waiting = Object.keys(rest).length > 0 ? rest : null;
    },
    flush,
    get failed() {
      return failed;
    },
  };
}

/** Autosavers of the components on screen, for `flushAllAutosaves`. */
const mounted = new Set<Autosave<object>>();

/**
 * Saves what every on-screen autosaver has waiting and resolves once all saves have finished:
 * true when everything is stored. Used before reloading into a new version (T4.7).
 */
export async function flushAllAutosaves(): Promise<boolean> {
  const all = [...mounted];
  await Promise.all(all.map((autosave) => autosave.flush()));
  return all.every((autosave) => !autosave.failed);
}

/**
 * One autosaver for the component's lifetime. Also saves right away when the page is hidden
 * (iOS may kill a backgrounded PWA without warning) and when the component unmounts.
 */
export function useAutosave<P extends object>(
  save: (patch: P) => Promise<unknown>,
  onState?: (state: AutosaveState) => void,
): Autosave<P> {
  // `save` and `onState` are fixed for the component's lifetime (callers key it by record id).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const autosave = useMemo(() => createAutosave(save, { onState }), []);

  useEffect(() => {
    mounted.add(autosave);
    const flushNow = () => void autosave.flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      mounted.delete(autosave);
      flushNow();
    };
  }, [autosave]);

  return autosave;
}
