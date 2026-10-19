import { render, screen } from '@testing-library/react';

import App from './App';
import es from './i18n/locales/es.json';

describe('App', () => {
  it('renders the home screen in Spanish from the es locale', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: es.app.name })).toBeInTheDocument();
    expect(screen.getByText(es.hello.title)).toBeInTheDocument();
    expect(screen.getByText(es.hello.subtitle)).toBeInTheDocument();
  });

  it('has a bottom navigation to the main sections', () => {
    render(<App />);

    const nav = screen.getByRole('navigation', { name: es.nav.label });
    expect(nav).toHaveTextContent(es.nav.home);
    expect(nav).toHaveTextContent(es.nav.clients);
  });

  it('does not show raw i18n keys', () => {
    render(<App />);

    expect(screen.queryByText(/^(app|hello|nav)\./)).not.toBeInTheDocument();
  });
});
