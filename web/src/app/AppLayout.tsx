import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

import { useDiscardSessionOnLeave } from '../features/sessions/leave';
import SyncBanner from '../features/sync/SyncBanner';

const NAV_ITEMS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/payments', key: 'nav.payments', end: false },
  { to: '/clients', key: 'nav.clients', end: false },
  { to: '/cards', key: 'nav.cards', end: false },
] as const;

/**
 * Page frame: content padded clear of the status bar / notch, and a bottom tab bar padded
 * clear of the home indicator (safe-area insets need `viewport-fit=cover`, set in index.html).
 */
export default function AppLayout() {
  const { t } = useTranslation();
  useDiscardSessionOnLeave();

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-2xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <SyncBanner />
        <Outlet />
      </main>
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-stone-50 pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-2xl">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-14 items-center justify-center text-base ${
                    isActive ? 'font-semibold text-stone-900' : 'text-stone-500'
                  }`
                }
              >
                {t(item.key)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
