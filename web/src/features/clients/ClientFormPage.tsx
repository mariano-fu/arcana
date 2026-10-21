import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { nowIso, repos, type Client } from '../../db';
import CityAutocomplete from './CityAutocomplete';
import {
  clientToForm,
  emptyClientForm,
  parseClientForm,
  type ClientFormErrorKey,
  type ClientFormValues,
} from './form';
import { useClient } from './hooks';

/** Create (`/clients/new`) or edit (`/clients/:id/edit`). */
export default function ClientFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const client = useClient(id);

  if (id === undefined) return <ClientForm client={null} />;
  if (client === undefined) return null;
  if (client === null) return <p className="py-8 text-center">{t('common.notFound')}</p>;
  return <ClientForm client={client} />;
}

function ClientForm({ client }: { client: Client | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [values, setValues] = useState<ClientFormValues>(() =>
    client ? clientToForm(client) : emptyClientForm(),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ClientFormValues, ClientFormErrorKey>>>(
    {},
  );
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const result = parseClientForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const saved = client
        ? await repos.client.update(client.id, result.fields)
        : await repos.client.create({
            ...result.fields,
            archived: false,
            created_at: nowIso(),
          });
      await navigate(`/clients/${saved.id}`, { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const timeZones = useMemo(() => {
    const zones = Intl.supportedValuesOf('timeZone');
    return values.birth_tz === '' || zones.includes(values.birth_tz)
      ? zones
      : [values.birth_tz, ...zones];
  }, [values.birth_tz]);

  const hasCoordinates =
    values.birth_lat !== '' && values.birth_lng !== '' && values.birth_tz !== '';
  const placeStatus = hasCoordinates
    ? t('clients.form.birthPlaceCoordinates', {
        lat: values.birth_lat,
        lng: values.birth_lng,
        tz: values.birth_tz,
      })
    : values.birth_place_label.trim() !== '' && !values.birth_place_manual
      ? t('clients.form.birthPlaceNoCoordinates')
      : t('clients.form.birthPlaceHint');

  const text = (id: string, key: 'instagram' | 'whatsapp', type = 'text') => (
    <input
      id={id}
      type={type}
      value={values[key]}
      onChange={(event) => {
        set(key, event.target.value);
      }}
      className={inputClass}
    />
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      <h1 className="text-2xl font-semibold">
        {client ? t('clients.form.editTitle') : t('clients.form.newTitle')}
      </h1>

      <Field
        label={t('clients.form.name')}
        error={errors.name && t(`clients.form.error.${errors.name}`)}
      >
        {(id) => (
          <input
            id={id}
            value={values.name}
            onChange={(event) => {
              set('name', event.target.value);
            }}
            required
            autoComplete="off"
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t('clients.form.instagram')}>{(id) => text(id, 'instagram')}</Field>
      <Field label={t('clients.form.whatsapp')}>{(id) => text(id, 'whatsapp', 'tel')}</Field>
      <Field
        label={t('clients.form.email')}
        error={errors.email && t(`clients.form.error.${errors.email}`)}
      >
        {(id) => (
          <input
            id={id}
            type="email"
            value={values.email}
            onChange={(event) => {
              set('email', event.target.value);
            }}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t('clients.form.birthDate')} hint={t('clients.form.birthDateHint')}>
        {(id) => (
          <input
            id={id}
            type="date"
            value={values.birth_date}
            onChange={(event) => {
              set('birth_date', event.target.value);
            }}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t('clients.form.birthTime')}>
        {(id) => (
          <input
            id={id}
            type="time"
            value={values.birth_time_unknown ? '' : values.birth_time}
            disabled={values.birth_time_unknown}
            onChange={(event) => {
              set('birth_time', event.target.value);
            }}
            className={`${inputClass} disabled:bg-stone-100 disabled:text-stone-400`}
          />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={values.birth_time_unknown}
          onChange={(event) => {
            set('birth_time_unknown', event.target.checked);
          }}
          className="size-5"
        />
        {t('clients.form.birthTimeUnknown')}
      </label>
      <Field label={t('clients.form.birthPlace')} hint={placeStatus}>
        {(id) => (
          <CityAutocomplete
            id={id}
            value={values.birth_place_label}
            suggestions={!values.birth_place_manual}
            onChange={(label) => {
              setValues((current) => ({
                ...current,
                birth_place_label: label,
                // A typed place no longer matches the picked city's coordinates.
                ...(current.birth_place_manual
                  ? {}
                  : { birth_lat: '', birth_lng: '', birth_tz: '' }),
              }));
            }}
            onSelect={(city) => {
              setValues((current) => ({
                ...current,
                birth_place_label: city.label,
                birth_lat: String(city.lat),
                birth_lng: String(city.lng),
                birth_tz: city.tz,
              }));
            }}
          />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={values.birth_place_manual}
          onChange={(event) => {
            set('birth_place_manual', event.target.checked);
          }}
          className="size-5"
        />
        {t('clients.form.birthPlaceManual')}
      </label>
      {values.birth_place_manual && (
        <>
          <Field
            label={t('clients.form.birthLat')}
            hint={t('clients.form.birthLatHint')}
            error={errors.birth_lat && t(`clients.form.error.${errors.birth_lat}`)}
          >
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                value={values.birth_lat}
                onChange={(event) => {
                  set('birth_lat', event.target.value);
                }}
                className={inputClass}
              />
            )}
          </Field>
          <Field
            label={t('clients.form.birthLng')}
            hint={t('clients.form.birthLngHint')}
            error={errors.birth_lng && t(`clients.form.error.${errors.birth_lng}`)}
          >
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                value={values.birth_lng}
                onChange={(event) => {
                  set('birth_lng', event.target.value);
                }}
                className={inputClass}
              />
            )}
          </Field>
          <Field
            label={t('clients.form.birthTz')}
            error={errors.birth_tz && t(`clients.form.error.${errors.birth_tz}`)}
          >
            {(id) => (
              <select
                id={id}
                value={values.birth_tz}
                onChange={(event) => {
                  set('birth_tz', event.target.value);
                }}
                className={inputClass}
              >
                <option value="">{t('clients.form.birthTzPlaceholder')}</option>
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <Field label={t('clients.form.tags')} hint={t('clients.form.tagsHint')}>
        {(id) => (
          <input
            id={id}
            value={values.tags}
            onChange={(event) => {
              set('tags', event.target.value);
            }}
            className={inputClass}
          />
        )}
      </Field>
      <Field label={t('clients.form.notes')}>
        {(id) => (
          <textarea
            id={id}
            value={values.notes}
            onChange={(event) => {
              set('notes', event.target.value);
            }}
            rows={5}
            className={`${inputClass} py-2`}
          />
        )}
      </Field>

      <div className="flex gap-3">
        <Link
          to={client ? `/clients/${client.id}` : '/clients'}
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-stone-300 text-base"
        >
          {t('common.cancel')}
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 flex-1 rounded-lg bg-stone-900 text-base font-medium text-stone-50 disabled:opacity-60"
        >
          {t('common.save')}
        </button>
      </div>
    </form>
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
