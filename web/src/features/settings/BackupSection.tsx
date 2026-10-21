import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { db } from '../../db';
import { syncEngine } from '../../sync';
import { readBackup, toExportFile } from '../backup/export';
import type { Backup, BackupProblem } from '../backup/format';
import { applyImport, previewImport, readBackupFile, type ImportCounts } from '../backup/import';
import { saveTextFile } from '../payments/download';
import SettingsSection from './SettingsSection';
import { appBuild } from './versions';

type ImportState =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'preview'; backup: Backup; counts: ImportCounts; exportedAt: string; future: number }
  | { step: 'importing' }
  | { step: 'done'; counts: ImportCounts }
  | { step: 'error'; problem: BackupProblem };

const COUNT_KEYS = ['added', 'updated', 'deleted', 'kept', 'unchanged'] as const;

const buttonClass =
  'min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base';

function formatExportDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Respaldo: one-tap JSON export (share sheet on her iPhone) and import with a preview. */
export default function BackupSection() {
  const { t } = useTranslation();
  // Read ahead, so the tap can open the share sheet with nothing awaited before it.
  const draft = useLiveQuery(() => readBackup(db, appBuild.version));
  const [exportFailed, setExportFailed] = useState(false);
  const [state, setState] = useState<ImportState>({ step: 'idle' });

  function exportNow() {
    if (!draft) return;
    const file = toExportFile(draft, new Date());
    setExportFailed(!file.ok);
    if (!file.ok) return;
    void saveTextFile(
      t('settings.backup.filename', { date: file.date }),
      file.text,
      'application/json',
    );
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Lets her pick the same file again.
    input.value = '';
    if (!file) return;
    setState({ step: 'reading' });
    const parsed = await readBackupFile(file);
    if (!parsed.ok) {
      setState({ step: 'error', problem: parsed.problem });
      return;
    }
    const preview = await previewImport(db, parsed.backup);
    setState(
      preview.ok
        ? {
            step: 'preview',
            backup: parsed.backup,
            counts: preview.counts,
            exportedAt: preview.exportedAt,
            future: preview.futureRows,
          }
        : { step: 'error', problem: preview.problem },
    );
  }

  async function confirm(backup: Backup) {
    setState({ step: 'importing' });
    const result = await applyImport(db, backup);
    if (!result.ok) {
      setState({ step: 'error', problem: result.problem });
      return;
    }
    setState({ step: 'done', counts: result.counts });
    // Import writes don't fire the local-edit trigger; push them now if she is signed in.
    void syncEngine.sync('local_write');
  }

  const busy = state.step === 'reading' || state.step === 'importing';

  return (
    <SettingsSection title={t('settings.backup.title')}>
      <p className="text-base">{t('settings.backup.explain')}</p>
      <p className="text-base text-stone-700">{t('settings.backup.private')}</p>

      <button type="button" disabled={!draft} onClick={exportNow} className={buttonClass}>
        {draft ? t('settings.backup.export') : t('settings.backup.preparing')}
      </button>
      {exportFailed && (
        <p role="alert" className="text-base text-red-700">
          {t('settings.backup.exportError')}
        </p>
      )}

      <label
        className={`${buttonClass} flex items-center focus-within:outline-2 ${busy ? 'opacity-50' : ''}`}
      >
        {t('settings.backup.import')}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy || state.step === 'preview'}
          onChange={(event) => {
            void pick(event);
          }}
          className="sr-only"
        />
      </label>

      <div aria-live="polite" className="flex flex-col gap-3">
        {state.step === 'reading' && <p>{t('settings.backup.reading')}</p>}
        {state.step === 'importing' && <p>{t('settings.backup.importing')}</p>}
        {state.step === 'error' && (
          <p role="alert" className="text-base text-red-700">
            {state.problem.kind === 'invalid' || state.problem.kind === 'missingParent'
              ? t(`settings.backup.error.${state.problem.kind}`, { count: state.problem.count })
              : t(`settings.backup.error.${state.problem.kind}`)}
          </p>
        )}
        {state.step === 'preview' && (
          <div
            role="group"
            aria-label={t('settings.backup.previewTitle', {
              date: formatExportDate(state.exportedAt),
            })}
            className="flex flex-col gap-3 rounded-lg border border-stone-300 p-3"
          >
            <p className="font-medium">
              {t('settings.backup.previewTitle', { date: formatExportDate(state.exportedAt) })}
            </p>
            <p>{t('settings.backup.previewIntro')}</p>
            <Counts counts={state.counts} />
            {state.future > 0 && (
              <p className="rounded-lg bg-amber-100 p-3 text-base text-amber-950">
                {t('settings.backup.future')}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  void confirm(state.backup);
                }}
                className="min-h-11 rounded-lg bg-stone-900 px-4 text-base font-medium text-stone-50"
              >
                {t('settings.backup.confirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setState({ step: 'idle' });
                }}
                className="min-h-11 text-base text-stone-600"
              >
                {t('settings.backup.cancel')}
              </button>
            </div>
          </div>
        )}
        {state.step === 'done' && (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t('settings.backup.done')}</p>
            <Counts counts={state.counts} />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function Counts({ counts }: { counts: ImportCounts }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1 text-base">
      {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
        <li key={key}>{t(`settings.backup.count.${key}`, { count: counts[key] })}</li>
      ))}
    </ul>
  );
}
