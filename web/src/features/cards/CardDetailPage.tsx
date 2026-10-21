import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';

import { cardName } from '../../seed/cards';
import CardImage from '../spreads/CardImage';
import { cardByKey } from '../spreads/cardSearch';
import CardNoteEditor from './CardNoteEditor';
import { useCardNote } from './hooks';

/** Where "Todas las cartas" returns to: the list with the search or tab she came from. */
function backTo(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('?') ? `/cards${from}` : '/cards';
}

/**
 * One card of the deck: large image, one orientation at a time ("Derecha / Invertida"),
 * keywords, arcana/suit, element and astrology, and her own note on the card.
 */
export default function CardDetailPage() {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const location = useLocation();
  const card = cardByKey(key);
  const note = useCardNote(key);
  const [reversed, setReversed] = useState(false);

  const back = (
    <Link to={backTo(location.state)} className="min-h-11 self-start py-2 text-base underline">
      {t('cards.reference.back')}
    </Link>
  );

  if (!card) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-base">{t('common.notFound')}</p>
      </div>
    );
  }

  const facts = [
    card.suit === null
      ? t('cards.arcana.major')
      : `${t('cards.arcana.minor')} · ${t(`cards.suit.${card.suit}`)}`,
    card.element && `${t('cards.field.element')}: ${t(`cards.element.${card.element}`)}`,
    card.astrology && `${t('cards.field.astrology')}: ${card.astrology}`,
  ].filter((fact): fact is string => typeof fact === 'string');

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="grid gap-5 sm:grid-cols-2">
        <section className="flex flex-col gap-3">
          <CardImage
            cardKey={card.key}
            size="full"
            reversed={reversed}
            alt=""
            className="mx-auto w-56 sm:w-full"
          />
          <h1 className="text-2xl font-semibold">{cardName(card, t)}</h1>
          <ul className="flex flex-col gap-0.5 text-sm text-stone-600">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <div
            role="group"
            aria-label={t('cards.reference.orientation')}
            className="flex gap-1 self-start rounded-lg bg-stone-200 p-1"
          >
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={reversed === value}
                onClick={() => {
                  setReversed(value);
                }}
                className={`min-h-11 rounded-md px-4 text-base ${
                  reversed === value ? 'bg-stone-900 text-stone-50' : ''
                }`}
              >
                {t(value ? 'cards.reference.reversed' : 'cards.reference.upright')}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium text-stone-700">
              {t(reversed ? 'cards.field.reversed' : 'cards.field.upright')}
            </h2>
            <p className="text-base">{reversed ? card.reversed : card.upright}</p>
          </div>
          <p className="text-sm text-stone-600">
            <span className="font-medium">{t('cards.field.keywords')}:</span>{' '}
            {card.keywords.join(', ')}
          </p>
          {note !== undefined && <CardNoteEditor key={card.key} cardId={card.key} initial={note} />}
        </section>
      </div>
    </div>
  );
}
