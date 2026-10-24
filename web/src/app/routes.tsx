import { Navigate, type RouteObject } from 'react-router';

import CardDetailPage from '../features/cards/CardDetailPage';
import CardListPage from '../features/cards/CardListPage';
import ConflictsPage from '../features/conflicts/ConflictsPage';
import HomePage from '../features/home/HomePage';
import ClientDetailPage from '../features/clients/ClientDetailPage';
import ClientFormPage from '../features/clients/ClientFormPage';
import ClientListPage from '../features/clients/ClientListPage';
import PaymentsPage from '../features/payments/PaymentsPage';
import SessionPage from '../features/sessions/SessionPage';
import SettingsPage from '../features/settings/SettingsPage';
import SpreadFormPage from '../features/spreads/builder/SpreadFormPage';
import SpreadListPage from '../features/spreads/builder/SpreadListPage';
import ReadingPage from '../features/spreads/ReadingPage';
import TemplatePickerPage from '../features/spreads/TemplatePickerPage';
import AppLayout from './AppLayout';

// Paths are English (code); only what she reads is Spanish.
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'clients', element: <ClientListPage /> },
      { path: 'clients/new', element: <ClientFormPage /> },
      { path: 'clients/:id', element: <ClientDetailPage /> },
      { path: 'clients/:id/edit', element: <ClientFormPage /> },
      { path: 'sessions/:id', element: <SessionPage /> },
      { path: 'sessions/:id/readings/new', element: <TemplatePickerPage /> },
      { path: 'sessions/:id/readings/:readingId', element: <ReadingPage /> },
      // Her spreads are managed from a session's "Nueva tirada" chooser, so they nest under it.
      { path: 'sessions/:id/spreads', element: <SpreadListPage /> },
      { path: 'sessions/:id/spreads/new', element: <SpreadFormPage /> },
      { path: 'sessions/:id/spreads/:spreadId/edit', element: <SpreadFormPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'cards', element: <CardListPage /> },
      { path: 'cards/:key', element: <CardDetailPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'conflicts', element: <ConflictsPage /> },
      // Acerca de moved into Ajustes (T1.14); old links still land there.
      { path: 'about', element: <Navigate to="/settings" replace /> },
    ],
  },
];
