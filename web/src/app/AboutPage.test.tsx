import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import es from '../i18n/locales/es.json';
import { routes } from './routes';

describe('Acerca de', () => {
  it('is linked from the home screen and credits GeoNames under CC BY 4.0', async () => {
    const user = userEvent.setup();
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);

    await user.click(screen.getByRole('link', { name: es.about.link }));

    expect(await screen.findByRole('heading', { level: 1, name: es.about.title })).toBeVisible();
    expect(screen.getByText(es.about.geonames)).toBeVisible();
    expect(screen.getByRole('link', { name: es.about.geonamesLink })).toHaveAttribute(
      'href',
      'https://www.geonames.org/',
    );
    expect(screen.getByRole('link', { name: es.about.licenseLink })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
  });
});
