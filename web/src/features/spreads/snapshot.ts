import type { SpreadSnapshot, SpreadTemplate } from '../../db';

/**
 * The spread as it is now, copied into a reading when it is created. A deep copy: the reading
 * keeps it unchanged forever, whatever later happens to the template (seed updates, her edits,
 * deletion), and past readings are drawn from it, never from the template.
 */
export function snapshotFromTemplate(
  template: Pick<SpreadTemplate, 'name' | 'positions'>,
): SpreadSnapshot {
  return {
    name: template.name,
    positions: template.positions.map(({ index, name, meaning, layout }) => ({
      index,
      name,
      meaning,
      layout:
        layout === null ? null : { col: layout.col, row: layout.row, rotated: layout.rotated },
    })),
  };
}
