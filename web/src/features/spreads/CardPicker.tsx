import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CardDraw } from '../../db';
import { cardName, type Card } from '../../seed/cards';
import { formatList } from '../clients/format';
import { positionsWithCard } from './actions';
import CardImage from './CardImage';
import { CARD_GROUPS, cardsInGroup, searchCards, type CardGroup } from './cardSearch';
import ConfirmDialog from './ConfirmDialog';
import Sheet from './Sheet';

interface Props {
  /** "1 · Situación actual". */
  positionLabel: string;
  positionIndex: number;
  /** The reading's live draws, to flag cards already in the spread. */
  draws: readonly CardDraw[];
  initialReversed: boolean;
  onPick: (card: { card_id: string; reversed: boolean }) => void;
  onClose: () => void;
}

/**
 * Picks the card she physically drew, in at most 3 taps: the position, then a card from the
 * majors tab (open by default) or a suit tab, or from search. "Invertida" can be set first, and
 * the thumbnails turn to show it.
 */
export default function CardPicker({
  positionLabel,
  positionIndex,
  draws,
  initialReversed,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<CardGroup>('major');
  const [reversed, setReversed] = useState(initialReversed);
  const [duplicate, setDuplicate] = useState<{ card: Card; positions: number[] } | null>(null);

  const searching = query.trim() !== '';
  const cards = useMemo(
    () => (searching ? searchCards(query, t) : cardsInGroup(group)),
    [searching, query, group, t],
  );
  const placedAt = useMemo(() => {
    const map = new Map<string, number>();
    for (const draw of draws) {
      if (draw.position_index !== positionIndex) map.set(draw.card_id, draw.position_index);
    }
    return map;
  }, [draws, positionIndex]);

  function choose(card: Card) {
    const positions = positionsWithCard(draws, card.key, positionIndex);
    if (positions.length > 0) setDuplicate({ card, positions });
    else onPick({ card_id: card.key, reversed });
  }

  const toolbar = (
    <>
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          aria-label={t('spreads.picker.search')}
          placeholder={t('spreads.picker.search')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          // 16px text keeps iOS Safari from zooming in on focus.
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base"
        />
        <button
          type="button"
          aria-pressed={reversed}
          onClick={() => {
            setReversed((current) => !current);
          }}
          className={`min-h-11 shrink-0 rounded-lg border px-3 text-base ${
            reversed ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-300 bg-white'
          }`}
        >
          {t('cards.field.reversed')}
        </button>
      </div>
      <div role="group" aria-label={t('spreads.picker.groups')} className="flex gap-1">
        {CARD_GROUPS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={!searching && group === key}
            onClick={() => {
              setGroup(key);
              setQuery('');
            }}
            className={`min-h-11 min-w-0 flex-1 rounded-lg px-1 text-sm ${
              !searching && group === key ? 'bg-stone-900 text-stone-50' : 'bg-stone-200'
            }`}
          >
            {key === 'major' ? t('spreads.picker.major') : t(`cards.suit.${key}`)}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <Sheet
      title={t('spreads.picker.title', { position: positionLabel })}
      onClose={onClose}
      toolbar={toolbar}
    >
      {cards.length === 0 ? (
        <p className="py-6 text-center text-base text-stone-600">
          {t('spreads.picker.noResults', { query: query.trim() })}
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map((card) => {
            const name = cardName(card, t);
            const at = placedAt.get(card.key);
            return (
              <li key={card.key}>
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => {
                    choose(card);
                  }}
                  className="relative flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center active:bg-stone-200"
                >
                  <CardImage
                    cardKey={card.key}
                    size="thumb"
                    reversed={reversed}
                    alt=""
                    className="w-full"
                  />
                  <span className="line-clamp-2 text-xs leading-tight">{name}</span>
                  {at !== undefined && (
                    <span className="absolute top-1 left-1 rounded bg-amber-200 px-1 text-xs">
                      {t('spreads.picker.inSpread', { index: at })}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {duplicate && (
        <ConfirmDialog
          title={t('spreads.picker.duplicate.title')}
          confirmLabel={t('spreads.picker.duplicate.confirm')}
          onConfirm={() => {
            onPick({ card_id: duplicate.card.key, reversed });
          }}
          onCancel={() => {
            setDuplicate(null);
          }}
        >
          <p className="text-base">
            {t('spreads.picker.duplicate.body', {
              card: cardName(duplicate.card, t),
              positions: formatList(duplicate.positions.map(String)),
            })}
          </p>
        </ConfirmDialog>
      )}
    </Sheet>
  );
}
