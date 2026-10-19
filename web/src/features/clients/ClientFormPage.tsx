import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { nowIso, repos, type Client } from '../../db';
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
            // Birth place stays free text until the city list (T2.2) fills these.
            birth_lat: null,
            birth_lng: null,
            birth_tz: null,
            archived: false,
            created_at: nowIso(),
          });
      await navigate(`/clients/${saved.id}`, { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const text = (id: string, key: 'instagram' | 'whatsapp' | 'birth_place_label', type = 'text') => (
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
      <Field label={t('clients.form.birthPlace')}>{(id) => text(id, 'birth_place_label')}</Field>
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
