import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { cardName } from '../../seed/cards';
import CardImage from '../spreads/CardImage';
import { CARD_GROUPS, cardsInGroup, searchCards, type CardGroup } from '../spreads/cardSearch';
import { useNotedCards } from './hooks';

const isGroup = (value: string | null): value is CardGroup =>
  CARD_GROUPS.some((group) => group === value);

/**
 * The deck reference: search by name or number, or browse the majors and each suit. Search
 * and tab live in the URL, so coming back from a card lands where she was.
 */
export default function CardListPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const groupParam = params.get('group');
  const group: CardGroup = isGroup(groupParam) ? groupParam : 'major';
  const noted = useNotedCards();

  const searching = query.trim() !== '';
  const cards = useMemo(
    () => (searching ? searchCards(query, t) : cardsInGroup(group)),
    [searching, query, group, t],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('cards.reference.title')}</h1>
      <input
        type="search"
        value={query}
        onChange={(event) => {
          const q = event.target.value;
          setParams(q === '' ? { group } : { q }, { replace: true });
        }}
        aria-label={t('spreads.picker.search')}
        placeholder={t('spreads.picker.search')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        // 16px text keeps iOS Safari from zooming in on focus.
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base"
      />
      <div role="group" aria-label={t('spreads.picker.groups')} className="flex gap-1">
        {CARD_GROUPS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={!searching && group === key}
            onClick={() => {
              setParams({ group: key }, { replace: true });
            }}
            className={`min-h-11 min-w-0 flex-1 rounded-lg px-1 text-sm ${
              !searching && group === key ? 'bg-stone-900 text-stone-50' : 'bg-stone-200'
            }`}
          >
            {key === 'major' ? t('spreads.picker.major') : t(`cards.suit.${key}`)}
          </button>
        ))}
      </div>

      {cards.length === 0 ? (
        <p className="py-6 text-center text-base text-stone-600">
          {t('spreads.picker.noResults', { query: query.trim() })}
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map((card) => {
            const name = cardName(card, t);
            const hasNote = noted?.has(card.key) ?? false;
            return (
              <li key={card.key}>
                <Link
                  to={`/cards/${card.key}`}
                  state={{ from: location.search }}
                  aria-label={hasNote ? t('cards.reference.withNote', { name }) : name}
                  className="relative flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center active:bg-stone-200"
                >
                  <CardImage
                    cardKey={card.key}
                    size="thumb"
                    reversed={false}
                    alt=""
                    className="w-full"
                  />
                  <span className="line-clamp-2 text-xs leading-tight">{name}</span>
                  {hasNote && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 left-1 rounded bg-amber-200 px-1 text-xs"
                    >
                      {t('cards.reference.noteBadge')}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
