import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for deletes. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bottom-sheet confirmation, the same pattern as deleting a session; sits above the sheets. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-stone-900/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-11 rounded-lg border text-base ${
              destructive
                ? 'border-red-300 text-red-700'
                : 'border-stone-900 bg-stone-900 text-stone-50'
            }`}
          >
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 text-base text-stone-600">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
