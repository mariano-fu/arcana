import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Viewport {
  top: number;
  height: number;
}

function readViewport(): Viewport | null {
  const viewport = window.visualViewport;
  return viewport ? { top: viewport.offsetTop, height: viewport.height } : null;
}

/**
 * The visible part of the page. On iOS the on-screen keyboard shrinks the visual viewport but
 * not `100dvh`, so a sheet sized to this keeps its scrolling list above the keyboard.
 */
function useVisualViewport(): Viewport | null {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const target = window.visualViewport;
    if (!target) return;
    const update = () => {
      setViewport(readViewport());
    };
    target.addEventListener('resize', update);
    target.addEventListener('scroll', update);
    return () => {
      target.removeEventListener('resize', update);
      target.removeEventListener('scroll', update);
    };
  }, []);
  return viewport;
}

interface Props {
  title: string;
  onClose: () => void;
  /** Stays put above the scrolling body (e.g. the picker's search box). */
  toolbar?: ReactNode;
  children: ReactNode;
}

/**
 * Full-screen sheet for one-handed use during a reading: a fixed header (and toolbar), and a
 * body that scrolls on its own. Padded clear of the notch and the home indicator.
 */
export default function Sheet({ title, onClose, toolbar, children }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const viewport = useVisualViewport();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
      className="fixed inset-x-0 top-0 z-20 flex h-dvh flex-col bg-stone-50 text-stone-900"
    >
      <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-2 border-b border-stone-200 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center text-base text-stone-600"
          >
            {t('common.close')}
          </button>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold">
            {title}
          </h2>
        </div>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
