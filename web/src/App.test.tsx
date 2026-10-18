import { render, screen } from '@testing-library/react';

import App from './App';
import es from './i18n/locales/es.json';

describe('App', () => {
  it('renders the hello screen in Spanish from the es locale', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: es.app.name })).toBeInTheDocument();
    expect(screen.getByText(es.hello.title)).toBeInTheDocument();
    expect(screen.getByText(es.hello.subtitle)).toBeInTheDocument();
  });

  it('does not show raw i18n keys', () => {
    render(<App />);

    expect(screen.queryByText(/^(app|hello)\./)).not.toBeInTheDocument();
  });
});
