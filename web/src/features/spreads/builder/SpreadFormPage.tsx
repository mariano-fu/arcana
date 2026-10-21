import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';

import { db, type SpreadTemplate } from '../../../db';
import { useSession } from '../../sessions/hooks';
import ConfirmDialog from '../ConfirmDialog';
import {
  createCustomSpread,
  deleteCustomSpread,
  SpreadNameTakenError,
  updateCustomSpread,
} from './actions';
import {
  emptyPosition,
  emptySpreadForm,
  MAX_POSITIONS,
  movePosition,
  parseSpreadForm,
  templateToForm,
  type SpreadFormErrors,
  type SpreadFormValues,
} from './form';
import { useOtherSpreadNames, useSpreadTemplate } from './hooks';
import LayoutEditor from './LayoutEditor';

/**
 * Create (`/sessions/:id/spreads/new`) or edit (`/sessions/:id/spreads/:spreadId/edit`) one of
 * her spreads. The routes sit under the session she came from, so saving returns to that
 * session's "Nueva tirada" chooser (or to "Mis tiradas" with `?from=list`, and after editing),
 * and a session still in its just-created state isn't discarded on the way.
 */
export default function SpreadFormPage() {
  const { t } = useTranslation();
  const { id: sessionId, spreadId } = useParams();
  const [search] = useSearchParams();
  const session = useSession(sessionId);
  const template = useSpreadTemplate(spreadId);
  const otherNames = useOtherSpreadNames(spreadId);

  if (session === undefined || otherNames === undefined) return null;
  if (spreadId !== undefined && template === undefined) return null;
  if (session === null || (spreadId !== undefined && (!template || template.is_seed))) {
    return <p className="py-8 text-center">{t('common.notFound')}</p>;
  }

  const listPath = `/sessions/${session.id}/spreads`;
  const returnPath =
    spreadId === undefined && search.get('from') !== 'list'
      ? `/sessions/${session.id}/readings/new`
      : listPath;
  return (
    <SpreadForm
      key={spreadId ?? 'new'}
      template={template ?? null}
      otherNames={otherNames}
      returnPath={returnPath}
      listPath={listPath}
    />
  );
}

function SpreadForm({
  template,
  otherNames,
  returnPath,
  listPath,
}: {
  template: SpreadTemplate | null;
  otherNames: string[];
  returnPath: string;
  listPath: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const initial = useMemo(
    () => (template ? templateToForm(template) : emptySpreadForm()),
    // Edits elsewhere while she's in the form don't reset what she typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [values, setValues] = useState<SpreadFormValues>(initial);
  const [errors, setErrors] = useState<SpreadFormErrors | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set right before navigating away on purpose (saved or deleted), so the guard lets it pass.
  const leaving = useRef(false);

  const dirty = useMemo(() => !sameForm(values, initial), [values, initial]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  function set<K extends keyof SpreadFormValues>(key: K, value: SpreadFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setPosition(i: number, patch: Partial<SpreadFormValues['positions'][number]>) {
    setValues((current) => ({
      ...current,
      positions: current.positions.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));
  }

  async function save() {
    const result = parseSpreadForm(values, otherNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    leaving.current = true;
    try {
      if (template) await updateCustomSpread(db, template.id, result.fields);
      else await createCustomSpread(db, result.fields);
      await navigate(returnPath, { replace: true });
    } catch (error) {
      leaving.current = false;
      if (!(error instanceof SpreadNameTakenError)) throw error;
      setErrors({ name: 'nameTaken', position: new Map() });
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (
    <button
      type="submit"
      disabled={saving}
      className="min-h-11 shrink-0 rounded-lg bg-stone-900 px-4 text-base text-stone-50"
    >
      {t('common.save')}
    </button>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-5"
    >
      {/* Sticky at the top rather than the bottom: on iOS the keyboard covers fixed footers. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-[max(1rem,env(safe-area-inset-top))] flex items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <Link
          to={returnPath}
          className="flex min-h-11 shrink-0 items-center text-base text-stone-600"
        >
          {t('common.cancel')}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-center text-lg font-semibold">
          {template ? t('spreads.builder.form.editTitle') : t('spreads.builder.form.newTitle')}
        </h1>
        {saveButton}
      </div>

      {errors && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {t('spreads.builder.error.summary')}
        </p>
      )}

      <Field
        label={t('spreads.builder.form.name')}
        error={errors?.name && t(`spreads.builder.error.${errors.name}`)}
      >
        {(id) => (
          <input
            id={id}
            value={values.name}
            onChange={(event) => {
              set('name', event.target.value);
            }}
            autoComplete="off"
            className={inputClass}
          />
        )}
      </Field>
      <Field
        label={t('spreads.builder.form.description')}
        hint={t('spreads.builder.form.descriptionHint')}
      >
        {(id) => (
          <textarea
            id={id}
            value={values.description}
            onChange={(event) => {
              set('description', event.target.value);
            }}
            rows={3}
            className={`${inputClass} py-2`}
          />
        )}
      </Field>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('spreads.builder.form.positions')}</h2>
        {errors?.positions && (
          <p role="alert" className="text-sm text-red-700">
            {t(`spreads.builder.error.${errors.positions}`, { max: MAX_POSITIONS })}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {values.positions.map((position, i) => {
            const index = i + 1;
            const error = errors?.position.get(index);
            return (
              <li
                key={position.key}
                className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex items-center gap-1">
                  <span className="flex-1 text-base font-semibold">{index}</span>
                  <IconButton
                    label={t('spreads.builder.form.moveUp', { index })}
                    disabled={i === 0}
                    onClick={() => {
                      set('positions', movePosition(values.positions, i, i - 1));
                    }}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label={t('spreads.builder.form.moveDown', { index })}
                    disabled={i === values.positions.length - 1}
                    onClick={() => {
                      set('positions', movePosition(values.positions, i, i + 1));
                    }}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label={t('spreads.builder.form.remove', { index })}
                    onClick={() => {
                      set(
                        'positions',
                        values.positions.filter((_, j) => j !== i),
                      );
                    }}
                  >
                    ✕
                  </IconButton>
                </div>
                <Field label={t('spreads.builder.form.positionName', { index })}>
                  {(id) => (
                    <input
                      id={id}
                      value={position.name}
                      onChange={(event) => {
                        setPosition(i, { name: event.target.value });
                      }}
                      autoComplete="off"
                      className={inputClass}
                    />
                  )}
                </Field>
                <Field
                  label={t('spreads.builder.form.positionMeaning', { index })}
                  hint={t('spreads.builder.form.positionMeaningHint')}
                >
                  {(id) => (
                    <textarea
                      id={id}
                      value={position.meaning}
                      onChange={(event) => {
                        setPosition(i, { meaning: event.target.value });
                      }}
                      rows={2}
                      className={`${inputClass} py-2`}
                    />
                  )}
                </Field>
                <p className="text-sm text-stone-600">
                  {position.layout === null
                    ? t('spreads.builder.layout.unplaced')
                    : t(
                        position.layout.rotated
                          ? 'spreads.builder.layout.placedCrossed'
                          : 'spreads.builder.layout.placed',
                        { row: position.layout.row + 1, col: position.layout.col + 1 },
                      )}
                </p>
                {error && (
                  <p role="alert" className="text-sm text-red-700">
                    {t(`spreads.builder.error.${error}`, { index })}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          disabled={values.positions.length >= MAX_POSITIONS}
          onClick={() => {
            set('positions', [...values.positions, emptyPosition()]);
          }}
          className="min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base disabled:text-stone-400"
        >
          {t('spreads.builder.form.add')}
        </button>
        {values.positions.length >= MAX_POSITIONS && (
          <p className="text-sm text-stone-600">
            {t('spreads.builder.form.maxPositions', { max: MAX_POSITIONS })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('spreads.builder.layout.title')}</h2>
        <LayoutEditor
          positions={values.positions}
          onChange={(positions) => {
            set('positions', positions);
          }}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {saveButton}
        {template && (
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(true);
            }}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-base text-red-700"
          >
            {t('spreads.builder.form.delete.button')}
          </button>
        )}
      </div>

      {confirmingDelete && template && (
        <ConfirmDialog
          title={t('spreads.builder.form.delete.title')}
          confirmLabel={t('spreads.builder.form.delete.confirm')}
          destructive
          onConfirm={() => {
            leaving.current = true;
            void deleteCustomSpread(db, template.id).then(() =>
              navigate(listPath, { replace: true }),
            );
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        >
          <p className="text-base">{t('spreads.builder.form.delete.body')}</p>
        </ConfirmDialog>
      )}

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title={t('spreads.builder.leave.title')}
          confirmLabel={t('spreads.builder.leave.confirm')}
          cancelLabel={t('spreads.builder.leave.cancel')}
          destructive
          onConfirm={() => {
            blocker.proceed();
          }}
          onCancel={() => {
            blocker.reset();
          }}
        >
          <p className="text-base">{t('spreads.builder.leave.body')}</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

/** Same content, ignoring the rows' React keys. */
function sameForm(a: SpreadFormValues, b: SpreadFormValues): boolean {
  const strip = (values: SpreadFormValues) => ({
    ...values,
    positions: values.positions.map(({ name, meaning, layout }) => ({ name, meaning, layout })),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// 16px text keeps iOS Safari from zooming in on focus.
const inputClass = 'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base';

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg text-stone-700 disabled:text-stone-300"
    >
      {children}
    </button>
  );
}

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
