import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { db } from '../../db';
import { useAutosave, type AutosaveState } from '../sessions/autosave';
import { saveCardNote } from './actions';

interface Props {
  cardId: string;
  /** The stored note when the editor opened. Mount with `key={cardId}`. */
  initial: string;
}

/**
 * Her note on a card, saved as she types (and right away on blur, when the app is hidden and
 * when she leaves the page). Readings show it next to the card's meaning.
 */
export default function CardNoteEditor({ cardId, initial }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [note, setNote] = useState(initial);
  const [saveState, setSaveState] = useState<AutosaveState>('idle');
  const autosave = useAutosave<{ note: string }>(
    (patch) => saveCardNote(db, cardId, patch.note),
    setSaveState,
  );

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {t('cards.reference.note')}
      </label>
      <p className="text-sm text-stone-600">{t('cards.reference.noteHint')}</p>
      <textarea
        id={id}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          autosave.schedule({ note: event.target.value });
        }}
        onBlur={() => void autosave.flush()}
        rows={6}
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base"
      />
      <p aria-live="polite" className="min-h-5 text-sm text-stone-500">
        {saveState === 'idle' ? '' : t(`sessions.save.${saveState}`)}
      </p>
    </div>
  );
}
