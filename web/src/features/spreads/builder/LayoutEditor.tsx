import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SPREAD_GRID } from '../../../seed/spreads';
import { placePosition, type SpreadFormPosition } from './form';

interface Props {
  positions: readonly SpreadFormPosition[];
  onChange: (positions: SpreadFormPosition[]) => void;
}

const toggleClass = (on: boolean) =>
  `min-h-11 min-w-11 rounded-lg border px-3 text-base ${
    on ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-300 bg-white'
  }`;

/**
 * Tap-to-place on the 7×5 spread grid: pick a position, then tap the cell where it goes.
 * "Cruzada" lays it crosswise over the card in that cell, "Sin lugar" takes it off the grid
 * (it then shows only in the reading's list). After placing, the next unplaced position is
 * picked, so laying out a new spread is one tap per card. Every target is at least 44 px.
 */
export default function LayoutEditor({ positions, onChange }: Props) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => (positions.find((p) => p.layout === null) ?? positions[0])?.key ?? null,
  );
  const selectedIndex = positions.findIndex((p) => p.key === selectedKey);
  const selected = positions[selectedIndex];
  const [crossed, setCrossed] = useState(selected?.layout?.rotated ?? false);

  function select(position: SpreadFormPosition) {
    setSelectedKey(position.key);
    setCrossed(position.layout?.rotated ?? false);
  }

  function place(col: number, row: number) {
    if (!selected) return;
    const next = placePosition(positions, selected.key, { col, row, rotated: crossed });
    onChange(next);
    const following = next.slice(selectedIndex + 1).find((p) => p.layout === null);
    if (following) select(following);
  }

  const label = (index: number, rotated: boolean) =>
    rotated ? t('spreads.builder.layout.crossedIndex', { index }) : String(index);

  const cells = [];
  for (let row = 0; row < SPREAD_GRID.rows; row++) {
    for (let col = 0; col < SPREAD_GRID.cols; col++) {
      const here = positions
        .map((position, i) => ({ index: i + 1, layout: position.layout }))
        .filter(({ layout }) => layout?.col === col && layout.row === row)
        .sort((a, b) => Number(a.layout?.rotated) - Number(b.layout?.rotated));
      const where = { row: row + 1, col: col + 1 };
      cells.push(
        <button
          key={`${String(col)},${String(row)}`}
          type="button"
          onClick={() => {
            place(col, row);
          }}
          aria-label={
            here.length === 0
              ? t('spreads.builder.layout.cell', where)
              : t('spreads.builder.layout.cellWith', {
                  ...where,
                  positions: here
                    .map(({ index, layout }) => label(index, layout?.rotated ?? false))
                    .join(', '),
                })
          }
          className={`relative flex min-h-11 items-center justify-center rounded border text-base ${
            here.length > 0 ? 'border-stone-900 bg-stone-200' : 'border-dashed border-stone-300'
          }`}
        >
          {here.map(({ index, layout }) =>
            layout?.rotated ? (
              <span
                key={index}
                className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded bg-amber-200/90 text-xs"
              >
                ↔ {index}
              </span>
            ) : (
              <span key={index} className="font-semibold">
                {index}
              </span>
            ),
          )}
        </button>,
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-600">{t('spreads.builder.layout.hint')}</p>
      <div
        role="group"
        aria-label={t('spreads.builder.layout.select')}
        className="flex flex-wrap gap-2"
      >
        {positions.map((position, i) => (
          <button
            key={position.key}
            type="button"
            aria-pressed={position.key === selectedKey}
            onClick={() => {
              select(position);
            }}
            className={toggleClass(position.key === selectedKey)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={crossed}
          disabled={!selected}
          onClick={() => {
            const next = !crossed;
            setCrossed(next);
            if (selected?.layout) {
              onChange(
                placePosition(positions, selected.key, { ...selected.layout, rotated: next }),
              );
            }
          }}
          className={toggleClass(crossed)}
        >
          {t('spreads.builder.layout.crossed')}
        </button>
        <button
          type="button"
          disabled={!selected || selected.layout === null}
          onClick={() => {
            if (selected) onChange(placePosition(positions, selected.key, null));
          }}
          className={toggleClass(false)}
        >
          {t('spreads.builder.layout.none')}
        </button>
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${String(SPREAD_GRID.cols)}, minmax(0, 1fr))` }}
      >
        {cells}
      </div>
    </div>
  );
}
