import type { SpreadTemplate } from '../../db';
import { sortTemplates } from './hooks';

const template = (name: string, seed_key: string | null) => ({ name, seed_key }) as SpreadTemplate;

describe('sortTemplates', () => {
  it('puts seed spreads first in seed order, then custom spreads by name', () => {
    const sorted = sortTemplates([
      template('Zeta', null),
      template('Cruz Celta', 'celtic-cross'),
      template('ámbito', null),
      template('1 carta', 'one-card'),
      template('Herradura', 'horseshoe'),
    ]);
    expect(sorted.map((t) => t.name)).toEqual([
      '1 carta',
      'Herradura',
      'Cruz Celta',
      'ámbito',
      'Zeta',
    ]);
  });
});
