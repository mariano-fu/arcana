import { render, screen } from '@testing-library/react';

import { clearDb } from './features/clients/test-utils';

import App from './App';
import es from './i18n/locales/es.json';

beforeEach(async () => {
  await clearDb();
});

describe('App', () => {
  it('renders the home screen in Spanish from the es locale', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeVisible();
    expect(await screen.findByText(es.home.followUps.empty)).toBeVisible();
  });

  it('has a bottom navigation to the main sections', () => {
    render(<App />);

    const nav = screen.getByRole('navigation', { name: es.nav.label });
    expect(nav).toHaveTextContent(es.nav.home);
    expect(nav).toHaveTextContent(es.nav.clients);
  });

  it('does not show raw i18n keys', () => {
    render(<App />);

    expect(screen.queryByText(/^(app|home|nav)\./)).not.toBeInTheDocument();
  });
});
