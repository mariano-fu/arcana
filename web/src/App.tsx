import { createBrowserRouter, RouterProvider } from 'react-router';

import { routes } from './app/routes';
import UpdateToast from './app/UpdateToast';

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <UpdateToast />
    </>
  );
}
