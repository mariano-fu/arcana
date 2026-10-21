import type { SpreadTemplate } from '../../db';
import { snapshotFromTemplate } from './snapshot';

const template: Pick<SpreadTemplate, 'name' | 'positions'> = {
  name: 'Mi tirada',
  positions: [
    { index: 1, name: 'Uno', meaning: 'Primero', layout: { col: 0, row: 0, rotated: false } },
    { index: 2, name: 'Dos', meaning: 'Cruza', layout: { col: 0, row: 0, rotated: true } },
    { index: 3, name: 'Tres', meaning: 'Sin lugar', layout: null },
  ],
};

describe('snapshotFromTemplate', () => {
  it('copies the name and each position number, name, meaning and layout', () => {
    expect(snapshotFromTemplate(template)).toEqual(template);
  });

  it('shares no objects with the template', () => {
    const snapshot = snapshotFromTemplate(template);
    expect(snapshot.positions).not.toBe(template.positions);
    expect(snapshot.positions[0]).not.toBe(template.positions[0]);
    expect(snapshot.positions[0]?.layout).not.toBe(template.positions[0]?.layout);
  });

  it('drops fields that are not part of the snapshot', () => {
    const snapshot = snapshotFromTemplate({
      ...template,
      positions: [{ ...template.positions[0], extra: true } as SpreadTemplate['positions'][number]],
    });
    expect(Object.keys(snapshot.positions[0] ?? {})).toEqual([
      'index',
      'name',
      'meaning',
      'layout',
    ]);
  });
});
