import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { db, type CardDraw, type SpreadSnapshotPosition } from '../../db';
import { cardName } from '../../seed/cards';
import { useAutosave } from '../sessions/autosave';
import { removeCard, setDrawNote, setReversed } from './actions';
import CardImage from './CardImage';
import { cardByKey } from './cardSearch';
import { useCardNote } from './hooks';
import Sheet from './Sheet';

interface Props {
  readingId: string;
  /** From the reading's snapshot, never from the current template. */
  position: SpreadSnapshotPosition;
  positionLabel: string;
  draw: CardDraw;
  onChangeCard: () => void;
  onClose: () => void;
}

/**
 * The placed card side by side with its position: full image (turned when reversed), the
 * meaning for its orientation, keywords, the position's meaning, her own note on the card
 * (read-only here; she edits it in the card reference) and a note for this position.
 * Mount with `key={draw.id}` so the note's autosaver belongs to one draw.
 */
export default function CardMeaningPanel({
  readingId,
  position,
  positionLabel,
  draw,
  onChangeCard,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const noteId = useId();
  const card = cardByKey(draw.card_id);
  const cardNote = useCardNote(draw.card_id);
  const [note, setNote] = useState(draw.note);
  const autosave = useAutosave<{ note: string }>((patch) =>
    setDrawNote(db, readingId, position.index, patch.note),
  );

  function close(then: () => void) {
    void autosave.flush().then(then);
  }

  return (
    <Sheet
      title={positionLabel}
      onClose={() => {
        close(onClose);
      }}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <section className="flex flex-col gap-3">
            <CardImage
              cardKey={draw.card_id}
              size="full"
              reversed={draw.reversed}
              alt=""
              className="mx-auto w-48 sm:w-full"
            />
            <h3 className="text-xl font-semibold">{card ? cardName(card, t) : draw.card_id}</h3>
            <button
              type="button"
              aria-pressed={draw.reversed}
              onClick={() => {
                void setReversed(db, readingId, position.index, !draw.reversed);
              }}
              className={`min-h-11 self-start rounded-lg border px-4 text-base ${
                draw.reversed
                  ? 'border-stone-900 bg-stone-900 text-stone-50'
                  : 'border-stone-300 bg-white'
              }`}
            >
              {t('cards.field.reversed')}
            </button>
            {card && (
              <>
                <p className="text-sm text-stone-600">
                  <span className="font-medium">{t('cards.field.keywords')}:</span>{' '}
                  {card.keywords.join(', ')}
                </p>
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-medium text-stone-700">
                    {t(draw.reversed ? 'cards.field.reversed' : 'cards.field.upright')}
                  </h4>
                  <p className="text-base">{draw.reversed ? card.reversed : card.upright}</p>
                </div>
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 rounded-lg bg-stone-100 p-3">
              <h4 className="text-sm font-medium text-stone-700">
                {t('spreads.panel.position', { name: position.name })}
              </h4>
              <p className="text-base">{position.meaning}</p>
            </div>
            {cardNote !== undefined && cardNote !== '' && (
              <div className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3">
                <h4 className="text-sm font-medium text-stone-700">
                  {t('spreads.panel.cardNote')}
                </h4>
                <p className="text-base whitespace-pre-line">{cardNote}</p>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor={noteId} className="text-sm font-medium text-stone-700">
                {t('spreads.panel.drawNote')}
              </label>
              <textarea
                id={noteId}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  autosave.schedule({ note: event.target.value });
                }}
                onBlur={() => void autosave.flush()}
                rows={4}
                className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base"
              />
            </div>
          </section>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              close(onChangeCard);
            }}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-base"
          >
            {t('spreads.panel.change')}
          </button>
          <button
            type="button"
            onClick={() => {
              close(() => {
                void removeCard(db, readingId, position.index).then(onClose);
              });
            }}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-base text-red-700"
          >
            {t('spreads.panel.remove')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
