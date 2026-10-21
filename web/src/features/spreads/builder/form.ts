import type { SpreadLayout, SpreadPosition, SpreadTemplate } from '../../../db';
import { newId } from '../../../db';
import { spreadLayoutIssues, type LayoutIssue } from '../../../seed/spreads';
import { foldText } from '../cardSearch';

/** Most positions a custom spread may have. */
export const MAX_POSITIONS = 20;

export interface SpreadFormPosition {
  /** Stable React key while she reorders rows; never saved. */
  key: string;
  name: string;
  meaning: string;
  layout: SpreadLayout | null;
}

/** Raw values as the editor holds them. Position numbers are the list order. */
export interface SpreadFormValues {
  name: string;
  description: string;
  positions: SpreadFormPosition[];
}

/** The template fields the builder edits. */
export type SpreadFormFields = Pick<SpreadTemplate, 'name' | 'description' | 'positions'>;

export type PositionErrorKey = 'positionName' | LayoutIssue;

export interface SpreadFormErrors {
  name?: 'nameRequired' | 'nameTaken';
  positions?: 'noPositions' | 'tooMany';
  /** By 1-based position number. */
  position: Map<number, PositionErrorKey>;
}

export type SpreadFormResult =
  { ok: true; fields: SpreadFormFields } | { ok: false; errors: SpreadFormErrors };

/** Whether `name` matches one of `names`, ignoring surrounding spaces, case and accents. */
export function nameTaken(name: string, names: readonly string[]): boolean {
  const folded = foldText(name);
  return names.some((other) => foldText(other) === folded);
}

/**
 * Validates the form. `otherNames` are the names of every other live spread, seed and custom
 * (not the one being edited), since the chooser lists them together.
 */
export function parseSpreadForm(
  values: SpreadFormValues,
  otherNames: readonly string[],
): SpreadFormResult {
  const errors: SpreadFormErrors = { position: new Map() };
  const name = values.name.trim();
  if (name === '') errors.name = 'nameRequired';
  else if (nameTaken(name, otherNames)) errors.name = 'nameTaken';

  if (values.positions.length === 0) errors.positions = 'noPositions';
  else if (values.positions.length > MAX_POSITIONS) errors.positions = 'tooMany';

  values.positions.forEach((position, i) => {
    if (position.name.trim() === '') errors.position.set(i + 1, 'positionName');
  });
  for (const { position, issue } of spreadLayoutIssues(values.positions)) {
    if (!errors.position.has(position + 1)) errors.position.set(position + 1, issue);
  }

  if (errors.name || errors.positions || errors.position.size > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      name,
      description: values.description.trim(),
      // Numbered 1..n in list order, whatever she moved or removed.
      positions: values.positions.map((position, i): SpreadPosition => ({
        index: i + 1,
        name: position.name.trim(),
        meaning: position.meaning.trim(),
        layout: position.layout && { ...position.layout },
      })),
    },
  };
}

export function emptyPosition(): SpreadFormPosition {
  return { key: newId(), name: '', meaning: '', layout: null };
}

export function emptySpreadForm(): SpreadFormValues {
  return { name: '', description: '', positions: [emptyPosition()] };
}

export function templateToForm(template: SpreadFormFields): SpreadFormValues {
  return {
    name: template.name,
    description: template.description,
    positions: [...template.positions]
      .sort((a, b) => a.index - b.index)
      .map((position) => ({
        key: newId(),
        name: position.name,
        meaning: position.meaning,
        layout: position.layout && { ...position.layout },
      })),
  };
}

/** Moves the position at `from` to `to` (list indexes), for the ↑/↓ buttons. */
export function movePosition<T>(positions: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= positions.length) return [...positions];
  const next = [...positions];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * Puts the position with `key` at `layout` (null: "Sin lugar"). Another position holding the
 * same cell and orientation is moved off the grid rather than stacked under it.
 */
export function placePosition(
  positions: readonly SpreadFormPosition[],
  key: string,
  layout: SpreadLayout | null,
): SpreadFormPosition[] {
  return positions.map((position) => {
    if (position.key === key) return { ...position, layout };
    const other = position.layout;
    if (
      layout !== null &&
      other !== null &&
      other.col === layout.col &&
      other.row === layout.row &&
      other.rotated === layout.rotated
    ) {
      return { ...position, layout: null };
    }
    return position;
  });
}

/**
 * The name for a copy: "<name> (copia)", or "(copia 2)", "(copia 3)"… for the first one not
 * taken. `label(n)` builds the Spanish name (n = 1 for the plain "(copia)").
 */
export function copyName(label: (n: number) => string, names: readonly string[]): string {
  for (let n = 1; ; n++) {
    const candidate = label(n);
    if (!nameTaken(candidate, names)) return candidate;
  }
}
