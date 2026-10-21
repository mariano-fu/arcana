import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { searchTimeZones, timeZoneLabel, timeZoneOptions, type TimeZoneOption } from './timeZones';

/** Roughly how long iOS takes to slide the keyboard in. */
const KEYBOARD_DELAY_MS = 300;

/**
 * Timezone field for manual birth-place entry (ARIA combobox). Focusing it lists the common
 * zones; typing searches every zone by Spanish label or IANA name. `value` is the IANA name;
 * clearing the text and leaving the field clears it.
 */
export default function TimeZoneAutocomplete({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  /** She typed since focusing; an empty field on blur then means "no timezone". */
  const typed = useRef(false);
  // Built once per field: a saved zone the browser doesn't list stays selectable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = useMemo(() => timeZoneOptions(t, value), [t]);

  const editing = query !== null;
  const results = useMemo(
    () => (editing ? searchTimeZones(options, query) : []),
    [editing, options, query],
  );
  const expanded = editing && results.length > 0;

  function select(option: TimeZoneOption) {
    typed.current = false;
    onChange(option.id);
    setQuery(null);
    setActive(-1);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        value={editing ? query : value === '' ? '' : timeZoneLabel(value, t)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
        placeholder={t('clients.form.birthTzPlaceholder')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => {
          typed.current = true;
          setQuery(event.target.value);
          setActive(-1);
        }}
        onFocus={() => {
          setQuery('');
          window.setTimeout(() => {
            inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }, KEYBOARD_DELAY_MS);
        }}
        onBlur={() => {
          // Typing and erasing everything means "no timezone"; any other text is dropped.
          if (typed.current && query?.trim() === '') onChange('');
          typed.current = false;
          setQuery(null);
        }}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => (current + 1) % results.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
          } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            const option = results[active];
            if (option) select(option);
          } else if (event.key === 'Escape') {
            setQuery(null);
          }
        }}
        className="min-h-11 w-full scroll-mt-4 rounded-lg border border-stone-300 bg-white px-3 text-base"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={t('clients.form.tz.suggestions')}
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-stone-300 bg-white shadow-lg"
      >
        {results.map((option, i) => (
          <li
            key={option.id}
            id={`${listId}-${String(i)}`}
            role="option"
            aria-selected={i === active}
            // Keep focus in the input so the blur does not close the list before the tap lands.
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              select(option);
              inputRef.current?.blur();
            }}
            className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-base ${
              i === active ? 'bg-stone-200' : ''
            }`}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
