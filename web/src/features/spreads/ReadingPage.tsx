import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { db, type CardDraw, type Reading, type SpreadSnapshotPosition } from '../../db';
import { cardName } from '../../seed/cards';
import { deleteReading, placeCard } from './actions';
import CardImage from './CardImage';
import CardMeaningPanel from './CardMeaningPanel';
import CardPicker from './CardPicker';
import { cardByKey } from './cardSearch';
import ConfirmDialog from './ConfirmDialog';
import { useReading, useReadingDraws } from './hooks';
import SpreadGrid from './SpreadGrid';

export default function ReadingPage() {
  const { t } = useTranslation();
  const { id: sessionId, readingId } = useParams();
  const reading = useReading(readingId);
  const draws = useReadingDraws(readingId ?? '');

  if (reading === undefined || draws === undefined) return null;
  if (reading === null || reading.session_id !== sessionId) {
    return <p className="py-8 text-center">{t('common.notFound')}</p>;
  }
  return <ReadingView reading={reading} draws={draws} />;
}

type Open = { kind: 'picker' | 'panel'; index: number } | null;

/** A reading, drawn entirely from its snapshot: never from the current spread template. */
function ReadingView({ reading, draws }: { reading: Reading; draws: CardDraw[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const positionsId = useId();
  const { positions } = reading.spread_snapshot;
  const sessionPath = `/sessions/${reading.session_id}`;

  const drawsByIndex = useMemo(
    () => new Map(draws.map((draw) => [draw.position_index, draw])),
    [draws],
  );
  const label = (position: SpreadSnapshotPosition) =>
    t('spreads.reading.position', { index: position.index, name: position.name });
  const nameOf = (draw: CardDraw) => {
    const card = cardByKey(draw.card_id);
    return card ? cardName(card, t) : draw.card_id;
  };

  function select(index: number) {
    setOpen({ kind: drawsByIndex.has(index) ? 'panel' : 'picker', index });
  }

  const current = open && positions.find((p) => p.index === open.index);
  const currentDraw = open ? drawsByIndex.get(open.index) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          to={sessionPath}
          className="flex min-h-11 items-center self-start text-base text-stone-600"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{reading.spread_snapshot.name}</h1>
      </header>

      <SpreadGrid positions={positions} drawsByIndex={drawsByIndex} onSelect={select} />

      <section className="flex flex-col gap-2">
        <h2 id={positionsId} className="text-lg font-semibold">
          {t('spreads.reading.positions')}
        </h2>
        <ol
          aria-labelledby={positionsId}
          className="flex flex-col divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white"
        >
          {positions.map((position) => {
            const draw = drawsByIndex.get(position.index);
            const card = draw
              ? draw.reversed
                ? t('spreads.reading.reversedCard', { card: nameOf(draw) })
                : nameOf(draw)
              : null;
            return (
              <li key={position.index}>
                <button
                  type="button"
                  aria-label={
                    card === null
                      ? t('spreads.reading.positionButtonEmpty', { position: label(position) })
                      : t('spreads.reading.positionButton', { position: label(position), card })
                  }
                  onClick={() => {
                    select(position.index);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left"
                >
                  <span className="flex w-8 shrink-0 justify-center">
                    {draw && (
                      <CardImage
                        cardKey={draw.card_id}
                        size="thumb"
                        reversed={draw.reversed}
                        alt=""
                        className="w-8"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base font-medium">{label(position)}</span>
                    <span className="text-sm text-stone-600">
                      {card ?? t('spreads.reading.chooseCard')}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <button
        type="button"
        onClick={() => {
          setConfirmingDelete(true);
        }}
        className="flex min-h-11 items-center justify-center self-start rounded-lg border border-stone-300 bg-white px-4 text-base text-red-700"
      >
        {t('spreads.reading.delete.button')}
      </button>

      {open?.kind === 'picker' && current && (
        <CardPicker
          positionLabel={label(current)}
          positionIndex={current.index}
          draws={draws}
          initialReversed={currentDraw?.reversed ?? false}
          onPick={(card) => {
            void placeCard(db, reading.id, current.index, card).then(() => {
              setOpen({ kind: 'panel', index: current.index });
            });
          }}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
      {open?.kind === 'panel' && current && currentDraw && (
        <CardMeaningPanel
          key={currentDraw.id}
          readingId={reading.id}
          position={current}
          positionLabel={label(current)}
          draw={currentDraw}
          onChangeCard={() => {
            setOpen({ kind: 'picker', index: current.index });
          }}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t('spreads.reading.delete.title')}
          confirmLabel={t('spreads.reading.delete.confirm')}
          destructive
          onConfirm={() => {
            void deleteReading(db, reading.id).then(() => navigate(sessionPath, { replace: true }));
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        >
          <p className="text-base">
            {draws.length === 0
              ? t('spreads.reading.delete.onlyReading')
              : t('spreads.reading.delete.summary', { count: draws.length })}
          </p>
          <p className="text-sm text-stone-600">{t('spreads.reading.delete.irreversible')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
