import { masculineWords } from '../test/gender-neutral';
import raw from './spreads.json';
import {
  SPREAD_GRID,
  spreadLayoutIssues,
  spreadsFileSchema,
  spreadsSeed,
  type SeedSpread,
  type SeedSpreadPosition,
  type SpreadsFile,
} from './spreads';

const clone = (): SpreadsFile => structuredClone(spreadsSeed);

function byKey(spreads: SeedSpread[], key: string): SeedSpread {
  const spread = spreads.find((s) => s.key === key);
  if (!spread) throw new Error(`missing ${key}`);
  return spread;
}

function position(file: SpreadsFile, key: string, i: number): SeedSpreadPosition {
  const found = byKey(file.spreads, key).positions[i];
  if (!found) throw new Error(`missing ${key} position ${String(i)}`);
  return found;
}

const positionNames = (key: string) => byKey(spreadsSeed.spreads, key).positions.map((p) => p.name);

describe('spreads seed', () => {
  it('passes the schema', () => {
    expect(spreadsFileSchema.safeParse(raw).success).toBe(true);
  });

  it('has the four agreed spreads with the right number of positions', () => {
    const sizes = Object.fromEntries(spreadsSeed.spreads.map((s) => [s.key, s.positions.length]));
    expect(sizes).toEqual({ 'one-card': 1, 'three-card': 3, horseshoe: 7, 'celtic-cross': 10 });
  });

  it('uses pasado / presente / futuro for 3 cartas', () => {
    expect(positionNames('three-card')).toEqual(['Pasado', 'Presente', 'Futuro']);
  });

  it('follows the agreed Herradura order', () => {
    expect(positionNames('horseshoe')).toEqual([
      'Pasado',
      'Presente',
      'Futuro próximo',
      'Consejo',
      'Entorno',
      'Esperanzas y temores',
      'Resultado',
    ]);
  });

  it('follows the modern Cruz Celta order: 3 Base, 5 Corona, 7 La persona consultante', () => {
    const names = positionNames('celtic-cross');
    expect(names[2]).toBe('Base');
    expect(names[4]).toBe('Corona');
    expect(names[6]).toBe('La persona consultante');
    expect(names[9]).toBe('Resultado');
  });

  it('lays the Cruz Celta challenge across the first card, and nothing else is rotated', () => {
    const rotated = spreadsSeed.spreads.flatMap((s) =>
      s.positions.filter((p) => p.layout.rotated).map((p) => `${s.key}:${String(p.index)}`),
    );
    expect(rotated).toEqual(['celtic-cross:2']);
    const [first, second] = byKey(spreadsSeed.spreads, 'celtic-cross').positions;
    expect(second?.layout).toEqual({ ...first?.layout, rotated: true });
  });

  it('gives every position a meaning that says more than its name', () => {
    for (const spread of spreadsSeed.spreads) {
      for (const position of spread.positions) {
        expect(position.meaning.length, `${spread.key}:${position.name}`).toBeGreaterThan(
          position.name.length + 40,
        );
      }
    }
  });
});

describe('gender-neutral spread texts', () => {
  it.each(spreadsSeed.spreads.map((s) => [s.key, s] as const))('%s', (_key, spread) => {
    const texts = [
      spread.name,
      spread.description,
      ...spread.positions.flatMap((p) => [p.name, p.meaning]),
    ];
    expect(texts.flatMap(masculineWords)).toEqual([]);
  });
});

describe('spreadsFileSchema', () => {
  it('rejects duplicate keys', () => {
    const file = clone();
    file.spreads.push(structuredClone(byKey(file.spreads, 'one-card')));
    expect(spreadsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects position indexes that are not 1..n in order', () => {
    const gap = clone();
    position(gap, 'three-card', 2).index = 4;
    expect(spreadsFileSchema.safeParse(gap).success).toBe(false);

    const zeroBased = clone();
    position(zeroBased, 'one-card', 0).index = 0;
    expect(spreadsFileSchema.safeParse(zeroBased).success).toBe(false);
  });

  it('rejects two upright cards in the same cell', () => {
    const file = clone();
    position(file, 'three-card', 1).layout = { col: 0, row: 0, rotated: false };
    expect(spreadsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects empty names, meanings and descriptions', () => {
    const name = clone();
    position(name, 'one-card', 0).name = ' ';
    expect(spreadsFileSchema.safeParse(name).success).toBe(false);

    const meaning = clone();
    position(meaning, 'one-card', 0).meaning = '';
    expect(spreadsFileSchema.safeParse(meaning).success).toBe(false);

    const description = clone();
    byKey(description.spreads, 'one-card').description = '';
    expect(spreadsFileSchema.safeParse(description).success).toBe(false);
  });

  it('rejects a spread with no positions', () => {
    const file = clone();
    byKey(file.spreads, 'one-card').positions = [];
    expect(spreadsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a position without a layout', () => {
    const file = clone();
    Reflect.deleteProperty(position(file, 'one-card', 0), 'layout');
    expect(spreadsFileSchema.safeParse(file).success).toBe(false);
  });
});

describe('spreadLayoutIssues', () => {
  const at = (col: number, row: number, rotated = false) => ({ layout: { col, row, rotated } });

  it('fits every seed layout inside the 7×5 grid the builder uses', () => {
    for (const spread of spreadsSeed.spreads) {
      for (const { layout } of spread.positions) {
        expect(layout.col).toBeLessThan(SPREAD_GRID.cols);
        expect(layout.row).toBeLessThan(SPREAD_GRID.rows);
      }
      expect(spreadLayoutIssues(spread.positions)).toEqual([]);
    }
  });

  it('flags cells outside the grid, taken cells and a crosswise card on its own', () => {
    expect(spreadLayoutIssues([at(7, 0), at(0, 5)])).toEqual([
      { position: 0, issue: 'outOfGrid' },
      { position: 1, issue: 'outOfGrid' },
    ]);
    expect(spreadLayoutIssues([at(1, 1), at(1, 1)])).toEqual([{ position: 1, issue: 'cellTaken' }]);
    expect(spreadLayoutIssues([at(1, 1, true)])).toEqual([{ position: 0, issue: 'crossingAlone' }]);
    expect(spreadLayoutIssues([at(1, 1, true), at(1, 1)])).toEqual([]);
    expect(spreadLayoutIssues([{ layout: null }, { layout: null }])).toEqual([]);
  });

  it('rejects a seed crosswise card with nothing under it', () => {
    const file = clone();
    position(file, 'three-card', 0).layout = { col: 5, row: 4, rotated: true };
    expect(spreadsFileSchema.safeParse(file).success).toBe(false);
  });
});
