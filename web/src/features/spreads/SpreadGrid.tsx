import type { CardDraw, SpreadLayout, SpreadSnapshotPosition } from '../../db';
import CardImage from './CardImage';

type PlacedPosition = SpreadSnapshotPosition & { layout: SpreadLayout };

interface Props {
  positions: readonly SpreadSnapshotPosition[];
  drawsByIndex: ReadonlyMap<number, CardDraw>;
  onSelect: (index: number) => void;
}

/** Positions that have a grid cell; custom spreads may have none. */
function placedPositions(positions: readonly SpreadSnapshotPosition[]): PlacedPosition[] {
  return positions.filter((p): p is PlacedPosition => p.layout !== null);
}

/**
 * The spread's shape, drawn from the reading's snapshot: one grid cell per `layout`, a card laid
 * crosswise over its cell when `rotated` (the Cruz Celta's Desafío). A visual aid only: it is
 * hidden from assistive tech and every card here is also in the position list below, whose rows
 * are full-width touch targets (the covered card under a crossing one is hard to hit here).
 */
export default function SpreadGrid({ positions, drawsByIndex, onSelect }: Props) {
  const placed = placedPositions(positions);
  if (placed.length === 0) return null;

  const cols = Math.max(...placed.map((p) => p.layout.col)) + 1;
  const rows = Math.max(...placed.map((p) => p.layout.row)) + 1;
  // Narrower cards leave room for a crosswise card to overhang its cell.
  const crossing = placed.some((p) => p.layout.rotated);
  const cardWidth = crossing ? 'w-[72%]' : 'w-full';

  const cells = new Map<string, { upright?: PlacedPosition; rotated?: PlacedPosition }>();
  for (const position of placed) {
    const key = `${String(position.layout.col)},${String(position.layout.row)}`;
    const cell = cells.get(key) ?? {};
    cell[position.layout.rotated ? 'rotated' : 'upright'] = position;
    cells.set(key, cell);
  }

  const slot = (position: PlacedPosition) => {
    const draw = drawsByIndex.get(position.index);
    return (
      <button
        type="button"
        tabIndex={-1}
        data-position={position.index}
        onClick={() => {
          onSelect(position.index);
        }}
        className={`pointer-events-auto relative block ${cardWidth} ${position.layout.rotated ? 'rotate-90' : ''}`}
      >
        {draw ? (
          <CardImage
            cardKey={draw.card_id}
            size="thumb"
            reversed={draw.reversed}
            alt=""
            className="w-full shadow"
          />
        ) : (
          <span className="flex aspect-[160/277] w-full items-center justify-center rounded-sm border-2 border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500" />
        )}
        <span className="absolute top-0.5 left-0.5 rounded bg-stone-900/70 px-1 text-xs text-stone-50">
          {position.index}
        </span>
      </button>
    );
  };

  return (
    <div
      aria-hidden="true"
      data-testid="spread-grid"
      className="mx-auto grid w-full gap-2"
      style={{
        gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${String(rows)}, auto)`,
        maxWidth: `${String(cols * 6)}rem`,
      }}
    >
      {[...cells.entries()].map(([key, cell]) => {
        const at = (cell.upright ?? cell.rotated)?.layout;
        if (!at) return null;
        return (
          <div
            key={key}
            className="relative flex justify-center"
            style={{ gridColumn: at.col + 1, gridRow: at.row + 1 }}
          >
            {cell.upright ? (
              slot(cell.upright)
            ) : (
              <span className={`block aspect-[160/277] ${cardWidth}`} />
            )}
            {cell.rotated && (
              // Only the crosswise card itself takes taps; the rest of the covered card stays tappable.
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                {slot(cell.rotated)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
