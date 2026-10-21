import {
  copyName,
  emptySpreadForm,
  MAX_POSITIONS,
  movePosition,
  nameTaken,
  parseSpreadForm,
  placePosition,
  templateToForm,
  type SpreadFormPosition,
  type SpreadFormValues,
} from './form';

const pos = (
  name: string,
  layout: SpreadFormPosition['layout'] = null,
  meaning = '',
): SpreadFormPosition => ({ key: name, name, meaning, layout });

const form = (positions: SpreadFormPosition[], name = 'Mi tirada'): SpreadFormValues => ({
  name,
  description: '',
  positions,
});

describe('parseSpreadForm', () => {
  it('trims and numbers positions 1..n in list order, layouts included', () => {
    const result = parseSpreadForm(
      {
        name: '  Mi tirada ',
        description: ' Para el amor ',
        positions: [
          pos(' Uno ', { col: 0, row: 0, rotated: false }, ' Lo primero '),
          pos('Dos'),
          pos('Tres', { col: 0, row: 0, rotated: true }),
        ],
      },
      [],
    );
    expect(result).toEqual({
      ok: true,
      fields: {
        name: 'Mi tirada',
        description: 'Para el amor',
        positions: [
          {
            index: 1,
            name: 'Uno',
            meaning: 'Lo primero',
            layout: { col: 0, row: 0, rotated: false },
          },
          { index: 2, name: 'Dos', meaning: '', layout: null },
          { index: 3, name: 'Tres', meaning: '', layout: { col: 0, row: 0, rotated: true } },
        ],
      },
    });
  });

  it('requires a name and position names', () => {
    const result = parseSpreadForm(form([pos('Uno'), pos(' ')], ' '), []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('nameRequired');
    expect([...result.errors.position]).toEqual([[2, 'positionName']]);
  });

  it('needs 1 to 20 positions', () => {
    const none = parseSpreadForm(form([]), []);
    expect(!none.ok && none.errors.positions).toBe('noPositions');

    const many = Array.from({ length: MAX_POSITIONS + 1 }, (_, i) => pos(`P${String(i)}`));
    const tooMany = parseSpreadForm(form(many), []);
    expect(!tooMany.ok && tooMany.errors.positions).toBe('tooMany');
    expect(parseSpreadForm(form(many.slice(0, MAX_POSITIONS)), []).ok).toBe(true);
  });

  it('rejects a name another spread has, ignoring case, accents and spaces', () => {
    const names = ['Cruz Celta', 'Tirada del Corazón'];
    for (const name of ['cruz celta', ' CRUZ CÉLTA ', 'tirada del corazon']) {
      const result = parseSpreadForm(form([pos('Uno')], name), names);
      expect(!result.ok && result.errors.name).toBe('nameTaken');
    }
    expect(parseSpreadForm(form([pos('Uno')], 'Cruz Celta 2'), names).ok).toBe(true);
  });

  it('applies the shared layout rules per position', () => {
    const result = parseSpreadForm(
      form([
        pos('A', { col: 1, row: 1, rotated: false }),
        pos('B', { col: 1, row: 1, rotated: false }),
        pos('C', { col: 3, row: 3, rotated: true }),
        pos('D', { col: 7, row: 0, rotated: false }),
      ]),
      [],
    );
    expect(!result.ok && [...result.errors.position]).toEqual([
      [2, 'cellTaken'],
      [4, 'outOfGrid'],
      [3, 'crossingAlone'],
    ]);
  });
});

describe('editing helpers', () => {
  it('starts a new spread with one empty, unplaced position', () => {
    const values = emptySpreadForm();
    expect(values.positions).toHaveLength(1);
    expect(values.positions[0]).toMatchObject({ name: '', meaning: '', layout: null });
  });

  it('loads a template in position order with copied layouts', () => {
    const layout = { col: 2, row: 1, rotated: false };
    const values = templateToForm({
      name: 'X',
      description: '',
      positions: [
        { index: 2, name: 'Dos', meaning: '', layout: null },
        { index: 1, name: 'Uno', meaning: 'm', layout },
      ],
    });
    expect(values.positions.map((p) => p.name)).toEqual(['Uno', 'Dos']);
    expect(values.positions[0]?.layout).toEqual(layout);
    expect(values.positions[0]?.layout).not.toBe(layout);
  });

  it('moves positions up and down, ignoring moves past the ends', () => {
    expect(movePosition(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(movePosition(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(movePosition(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it("swaps two positions when one is placed on the other's cell and orientation", () => {
    const a = { col: 0, row: 0, rotated: false };
    const b = { col: 2, row: 1, rotated: false };
    const positions = [pos('A', a), pos('B', b), pos('C', { col: 0, row: 0, rotated: true })];
    expect(placePosition(positions, 'B', a).map((p) => p.layout)).toEqual([
      b,
      a,
      { col: 0, row: 0, rotated: true },
    ]);
    // Unplaced before the move: the other one goes to "Sin lugar".
    const unplaced = placePosition([pos('A', a), pos('B')], 'B', a);
    expect(unplaced.map((p) => p.layout)).toEqual([null, a]);
    // The same cell crosswise is not a collision.
    const crosswise = placePosition([pos('A', a), pos('B')], 'B', { ...a, rotated: true });
    expect(crosswise[0]?.layout).toEqual(a);
    expect(placePosition(positions, 'A', null)[0]?.layout).toBeNull();
  });

  it('numbers copies with the first free number', () => {
    const label = (n: number) =>
      n === 1 ? 'Cruz Celta (copia)' : `Cruz Celta (copia ${String(n)})`;
    expect(copyName(label, ['Cruz Celta'])).toBe('Cruz Celta (copia)');
    expect(copyName(label, ['Cruz Celta', 'cruz celta (COPIA)'])).toBe('Cruz Celta (copia 2)');
    expect(copyName(label, ['Cruz Celta (copia)', 'Cruz Celta (copia 3)'])).toBe(
      'Cruz Celta (copia 2)',
    );
  });

  it('compares names without case, accents or surrounding spaces', () => {
    expect(nameTaken(' Corazón ', ['corazon'])).toBe(true);
    expect(nameTaken('Corazones', ['corazon'])).toBe(false);
  });
});
