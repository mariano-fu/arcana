import { useCallback, useEffect, useState } from 'react';

/**
 * Forms with an explicit "Guardar" that have unsaved edits right now (T4.7 U3). Autosaved
 * fields aren't here: `flushAllAutosaves` stores those. Before reloading into a new version the
 * update toast asks first when this isn't empty, since a reload would lose what she typed.
 */
const dirtyForms = new Set<object>();

export function hasUnsavedForms(): boolean {
  return dirtyForms.size > 0;
}

/**
 * Registers the form as unsaved while `dirty` is true and the form is mounted. Returns `clear`,
 * for after a save or a cancel: the form no longer counts until `dirty` changes again.
 */
export function useUnsavedForm(dirty: boolean): () => void {
  const [token] = useState(() => ({}));

  useEffect(() => {
    if (dirty) dirtyForms.add(token);
    return () => {
      dirtyForms.delete(token);
    };
  }, [dirty, token]);

  return useCallback(() => {
    dirtyForms.delete(token);
  }, [token]);
}

/** Whether a flat form (no nested objects) differs from its starting values. */
export function isEdited<T extends object>(values: T, initial: T): boolean {
  return (Object.keys(values) as (keyof T)[]).some((key) => values[key] !== initial[key]);
}
