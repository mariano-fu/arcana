import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { db, repos, type Client, type Currency, type Session } from '../../db';
import { useClient } from '../clients/hooks';
import { CURRENCIES, CURRENCY_SYMBOL, formatMoney } from '../payments';
import SessionCrystals from '../crystals/SessionCrystals';
import SessionPayments from '../payments/SessionPayments';
import SessionReadings from '../spreads/SessionReadings';
import { deleteSession } from './actions';
import { useAutosave, type AutosaveState } from './autosave';
import DeleteSessionDialog from './DeleteSessionDialog';
import {
  parsePriceInput,
  parseSessionRouteState,
  priceToInput,
  SESSION_TYPES,
  fromLocalInput,
  toLocalInput,
  type SessionFields,
  type SessionRouteState,
} from './form';
import { useSession } from './hooks';
import { registerSessionFlush } from './leave';

export default function SessionPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const location = useLocation();
  const session = useSession(id);
  const client = useClient(session?.client_id);
  const routeState = useMemo(() => parseSessionRouteState(location.state), [location.state]);

  if (session === undefined || (session !== null && client === undefined)) return null;
  if (session === null || client === null || client === undefined) {
    return <p className="py-8 text-center">{t('common.notFound')}</p>;
  }
  return (
    <SessionEditor
      // A fresh editor (and autosaver) per session.
      key={session.id}
      session={session}
      client={client}
      routeState={routeState}
    />
  );
}

/** Raw values as the inputs hold them. */
interface SessionFormValues {
  started_at: string;
  type: Session['type'];
  price: string;
  currency: Currency;
  notes: string;
  follow_up_note: string;
  follow_up_date: string;
}

/**
 * Every change saves itself: pickers and dates right away, text after a pause, on blur, when
 * the app is hidden and when she leaves. There is no Save button.
 */
function SessionEditor({
  session,
  client,
  routeState,
}: {
  session: Session;
  client: Client;
  routeState: SessionRouteState | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [values, setValues] = useState<SessionFormValues>(() => ({
    started_at: toLocalInput(session.started_at),
    type: session.type,
    price: priceToInput(session.price_minor, session.currency),
    currency: session.currency,
    notes: session.notes,
    follow_up_note: session.follow_up_note,
    follow_up_date: session.follow_up_date ?? '',
  }));
  const [errors, setErrors] = useState<{ started_at?: boolean; price?: boolean }>({});
  const [saveState, setSaveState] = useState<AutosaveState>('idle');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const autosave = useAutosave<Partial<SessionFields>>(
    (patch) => repos.session.update(session.id, patch),
    setSaveState,
  );

  // Leaving the page waits for this before checking whether a new session was touched.
  useEffect(() => {
    registerSessionFlush(session.id, () => autosave.flush());
  }, [autosave, session.id]);

  function set<K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function saveNow(patch: Partial<SessionFields>) {
    autosave.schedule(patch);
    void autosave.flush();
  }

  const parsedPrice = parsePriceInput(values.price);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          to={`/clients/${client.id}`}
          className="flex min-h-11 items-center self-start text-base text-stone-600"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('sessions.title', { name: client.name })}</h1>
        {routeState?.unarchived && (
          <p role="status" className="self-start rounded-lg bg-amber-100 px-3 py-2 text-sm">
            {t('sessions.unarchivedNotice')}
          </p>
        )}
        <p aria-live="polite" className="min-h-5 text-sm text-stone-500">
          {saveState === 'idle' ? '' : t(`sessions.save.${saveState}`)}
        </p>
      </header>

      <Field
        label={t('sessions.field.startedAt')}
        error={errors.started_at ? t('sessions.error.startedAt') : undefined}
      >
        {(id) => (
          <input
            id={id}
            type="datetime-local"
            value={values.started_at}
            onChange={(event) => {
              set('started_at', event.target.value);
              const startedAt = fromLocalInput(event.target.value);
              setErrors((current) => ({ ...current, started_at: startedAt === null }));
              if (startedAt !== null) saveNow({ started_at: startedAt });
            }}
            className={inputClass}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-stone-700">
          {t('sessions.type.label')}
        </legend>
        <div className="flex gap-2">
          {SESSION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={values.type === type}
              onClick={() => {
                set('type', type);
                saveNow({ type });
              }}
              className={`min-h-11 flex-1 rounded-lg border px-2 text-base ${
                values.type === type
                  ? 'border-stone-900 bg-stone-900 text-stone-50'
                  : 'border-stone-300 bg-white'
              }`}
            >
              {t(`sessions.type.${type}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <div className="flex-1">
          <Field
            label={t('sessions.field.price')}
            hint={
              typeof parsedPrice === 'number'
                ? t('sessions.field.pricePreview', {
                    amount: formatMoney(parsedPrice, values.currency),
                  })
                : t('sessions.field.priceHint')
            }
            error={errors.price ? t('sessions.error.price') : undefined}
          >
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                value={values.price}
                onChange={(event) => {
                  set('price', event.target.value);
                  const price = parsePriceInput(event.target.value);
                  setErrors((current) => ({ ...current, price: price === undefined }));
                  // While the text is invalid, the stored price stays as it was.
                  if (price === undefined) autosave.drop('price_minor');
                  else autosave.schedule({ price_minor: price });
                }}
                onBlur={() => void autosave.flush()}
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <Field label={t('sessions.field.currency')}>
          {(id) => (
            <select
              id={id}
              value={values.currency}
              onChange={(event) => {
                const currency = event.target.value as Currency;
                set('currency', currency);
                saveNow({ currency });
              }}
              className={inputClass}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {CURRENCY_SYMBOL[currency]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <SessionPayments session={session} />

      <Field label={t('sessions.field.notes')}>
        {(id) => (
          <textarea
            id={id}
            value={values.notes}
            onChange={(event) => {
              set('notes', event.target.value);
              autosave.schedule({ notes: event.target.value });
            }}
            onBlur={() => void autosave.flush()}
            rows={8}
            className={`${inputClass} py-2`}
          />
        )}
      </Field>

      <SessionReadings sessionId={session.id} />

      <SessionCrystals sessionId={session.id} client={client} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('sessions.field.followUp')}</h2>
        <Field label={t('sessions.field.followUpNote')} hint={t('sessions.field.followUpNoteHint')}>
          {(id) => (
            <textarea
              id={id}
              value={values.follow_up_note}
              onChange={(event) => {
                set('follow_up_note', event.target.value);
                autosave.schedule({ follow_up_note: event.target.value });
              }}
              onBlur={() => void autosave.flush()}
              rows={3}
              className={`${inputClass} py-2`}
            />
          )}
        </Field>
        <Field label={t('sessions.field.followUpDate')}>
          {(id) => (
            <input
              id={id}
              type="date"
              value={values.follow_up_date}
              onChange={(event) => {
                set('follow_up_date', event.target.value);
                saveNow({ follow_up_date: event.target.value === '' ? null : event.target.value });
              }}
              className={inputClass}
            />
          )}
        </Field>
      </section>

      <button
        type="button"
        onClick={() => {
          setConfirmingDelete(true);
        }}
        className="flex min-h-11 items-center justify-center self-start rounded-lg border border-stone-300 bg-white px-4 text-base text-red-700"
      >
        {t('sessions.delete.button')}
      </button>

      {confirmingDelete && (
        <DeleteSessionDialog
          sessionId={session.id}
          onDelete={() => {
            void autosave
              .flush()
              .then(() => deleteSession(db, session.id))
              .then(() => navigate(`/clients/${client.id}`, { replace: true }));
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        />
      )}
    </div>
  );
}

// 16px text keeps iOS Safari from zooming in on focus.
const inputClass = 'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-stone-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
