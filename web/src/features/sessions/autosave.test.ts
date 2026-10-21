import { renderHook } from '@testing-library/react';

import { createAutosave, useAutosave, type AutosaveState } from './autosave';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave', () => {
  it('waits for a pause and saves the merged patch once', async () => {
    const save = vi.fn<(patch: { notes?: string; type?: string }) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const autosave = createAutosave(save, { delay: 600 });

    autosave.schedule({ notes: 'H' });
    await vi.advanceTimersByTimeAsync(300);
    autosave.schedule({ notes: 'Hola' });
    autosave.schedule({ type: 'online' });
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ notes: 'Hola', type: 'online' });
  });

  it('flush saves right away and resolves after the write', async () => {
    let written = '';
    const autosave = createAutosave(async ({ notes }: { notes: string }) => {
      await Promise.resolve();
      written = notes;
    });

    autosave.schedule({ notes: 'Hola' });
    await autosave.flush();

    expect(written).toBe('Hola');
    // Nothing waiting: flushing again doesn't write.
    written = '';
    await autosave.flush();
    expect(written).toBe('');
  });

  it('drop forgets waiting changes to the given fields only', async () => {
    const save = vi.fn<(patch: { notes?: string; price_minor?: number | null }) => Promise<void>>(
      () => Promise.resolve(),
    );
    const autosave = createAutosave(save);

    autosave.schedule({ price_minor: null, notes: 'Hola' });
    autosave.drop('price_minor');
    await autosave.flush();
    autosave.schedule({ price_minor: null });
    autosave.drop('price_minor');
    await autosave.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ notes: 'Hola' });
  });

  it('runs saves in order, so an older write never lands last', async () => {
    const order: string[] = [];
    const autosave = createAutosave(async ({ notes }: { notes: string }) => {
      // The first save is the slow one.
      await new Promise((resolve) => setTimeout(resolve, notes === 'a' ? 100 : 1));
      order.push(notes);
    });

    autosave.schedule({ notes: 'a' });
    void autosave.flush();
    autosave.schedule({ notes: 'b' });
    const done = autosave.flush();
    await vi.advanceTimersByTimeAsync(200);
    await done;

    expect(order).toEqual(['a', 'b']);
  });

  it('reports saving, saved and errors', async () => {
    const states: AutosaveState[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = false;
    const autosave = createAutosave(
      () => (fail ? Promise.reject(new Error('quota')) : Promise.resolve()),
      { onState: (state) => states.push(state) },
    );

    autosave.schedule({});
    await autosave.flush();
    fail = true;
    autosave.schedule({});
    await autosave.flush();

    expect(states).toEqual(['saving', 'saved', 'saving', 'error']);
  });
});

describe('useAutosave', () => {
  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  }

  afterEach(() => {
    setVisibility('visible');
  });

  function mount() {
    const save = vi.fn<(patch: { notes: string }) => Promise<void>>(() => Promise.resolve());
    const hook = renderHook(() => useAutosave(save));
    hook.result.current.schedule({ notes: 'Hola' });
    return { save, ...hook };
  }

  // Each save runs after the ones before it, on a microtask; the 600 ms pause never passes here.
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('saves right away when the app is hidden', async () => {
    const { save } = mount();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(save).toHaveBeenCalledWith({ notes: 'Hola' });
  });

  it('does not save early when the app becomes visible', async () => {
    const { save } = mount();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves right away on pagehide', async () => {
    const { save } = mount();
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(save).toHaveBeenCalledWith({ notes: 'Hola' });
  });

  it('saves right away on unmount', async () => {
    const { save, unmount } = mount();
    unmount();
    await settle();
    expect(save).toHaveBeenCalledWith({ notes: 'Hola' });
  });
});
