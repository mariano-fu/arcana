import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { loadCities, searchCities, type City, type CityIndex } from '../../seed/cities';

/** Fewer letters match too much of the list to be useful. */
const MIN_QUERY_LENGTH = 2;
/** Roughly how long iOS takes to slide the keyboard in. */
const KEYBOARD_DELAY_MS = 300;

/**
 * Birth-place input with offline city suggestions (ARIA combobox). Typing calls `onChange`;
 * picking a suggestion calls `onSelect`. On focus it scrolls itself to the top of the screen, so
 * on an iPhone the suggestions show above the keyboard instead of under it.
 */
export default function CityAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  suggestions = true,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (city: City) => void;
  /** False in manual mode: the input is plain text. */
  suggestions?: boolean;
  describedBy?: string | undefined;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState<CityIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!suggestions) return;
    let cancelled = false;
    void loadCities().then((loaded) => {
      if (!cancelled) setIndex(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [suggestions]);

  const results = useMemo(
    () =>
      index && suggestions && value.trim().length >= MIN_QUERY_LENGTH
        ? searchCities(index, value)
        : [],
    [index, suggestions, value],
  );
  const expanded = open && results.length > 0;

  function select(city: City) {
    onSelect(city);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        value={value}
        role={suggestions ? 'combobox' : undefined}
        aria-autocomplete={suggestions ? 'list' : undefined}
        aria-expanded={suggestions ? expanded : undefined}
        aria-controls={suggestions ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setOpen(true);
          if (!suggestions) return;
          window.setTimeout(() => {
            inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }, KEYBOARD_DELAY_MS);
        }}
        onBlur={() => {
          setOpen(false);
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
            const city = results[active];
            if (city) select(city);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="min-h-11 w-full scroll-mt-4 rounded-lg border border-stone-300 bg-white px-3 text-base"
      />
      {suggestions && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('clients.form.citySuggestions')}
          hidden={!expanded}
          className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-stone-300 bg-white shadow-lg"
        >
          {results.map((city, i) => (
            <li
              key={city.label}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the blur does not close the list before the tap lands.
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                select(city);
              }}
              className={`flex min-h-11 cursor-pointer items-center px-3 text-base ${
                i === active ? 'bg-stone-200' : ''
              }`}
            >
              {city.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
