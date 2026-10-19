import type { RouteObject } from 'react-router';

import ClientDetailPage from '../features/clients/ClientDetailPage';
import ClientFormPage from '../features/clients/ClientFormPage';
import ClientListPage from '../features/clients/ClientListPage';
import SessionPage from '../features/sessions/SessionPage';
import AppLayout from './AppLayout';
import HomePage from './HomePage';

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
    ],
  },
];
