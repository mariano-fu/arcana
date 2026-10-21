import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { repos, type Client, type NewRow } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb, newClient } from '../clients/test-utils';

const P = es.astro.panel;
const CR = 'America/Costa_Rica';
const SAN_JOSE = { birth_lat: 9.9333, birth_lng: -84.0833, birth_tz: CR };

async function openClient(overrides: Partial<NewRow<Client>>) {
  const client = await repos.client.create(newClient({ name: 'Ana Prueba', ...overrides }));
  const router = createMemoryRouter(routes, { initialEntries: [`/clients/${client.id}`] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' });
  return client;
}

const panel = () => {
  const heading = screen.getByRole('heading', { level: 2, name: es.clients.detail.astrology });
  const section = heading.closest('section');
  if (!section) throw new Error('no astrology section');
  return within(section);
};

/** The value next to a label in a definition list. */
function valueOf(label: string, scope = panel()) {
  return scope.getAllByText(label, { selector: 'dt' })[0]?.nextElementSibling?.textContent;
}

beforeEach(async () => {
  await clearDb();
});

describe('astrology panel', () => {
  it('asks for the birth date, with a link to edit', async () => {
    const client = await openClient({});
    expect(panel().getByText(P.missingDate)).toBeVisible();
    expect(panel().getByRole('link', { name: P.edit })).toHaveAttribute(
      'href',
      `/clients/${client.id}/edit`,
    );
  });

  it('shows the sun profile from the date alone, and says the place is missing', async () => {
    await openClient({ birth_date: '1990-08-10' });
    expect(valueOf(P.sun)).toBe('Leo');
    expect(valueOf(P.moon)).toBe(P.needsPlace);
    expect(valueOf(P.rising)).toBe(P.needsPlace);
    expect(panel().getByText(P.noPlace)).toBeVisible();
    expect(panel().getByRole('heading', { level: 3, name: /Perfil de Leo/ })).toBeVisible();
    expect(valueOf(P.element)).toBe('Fuego');
    expect(valueOf(P.modality)).toBe('Fijo');
    expect(valueOf(P.ruler)).toBe('Sol');
    expect(panel().getByText('Del 23 de julio al 22 de agosto')).toBeVisible();
    expect(panel().queryByText(P.chart)).not.toBeInTheDocument();
  });

  it('shows the traditional ruler when it differs', async () => {
    await openClient({ birth_date: '1990-11-10' });
    expect(valueOf(P.ruler)).toBe('Plutón (tradicional: Marte)');
  });

  it('explains a place without coordinates', async () => {
    await openClient({ birth_date: '1990-08-10', birth_place_label: 'Finca en Dota' });
    expect(panel().getByText(P.noCoordinates)).toBeVisible();
  });

  it('names both signs on a sun cusp date', async () => {
    await openClient({ birth_date: '2024-03-19' });
    expect(valueOf(P.sun)).toBe('Piscis o Aries');
    expect(
      panel().getByText(
        'El Sol cambia de signo ese día: puede ser Piscis o Aries. Con la hora y el lugar se sabe cuál.',
      ),
    ).toBeVisible();
  });

  it('without the time: planets by sign, the spec message, and the uncertain Moon', async () => {
    const user = userEvent.setup();
    await openClient({ birth_date: '2021-03-29', ...SAN_JOSE });
    expect(panel().getByText(P.noTime)).toBeVisible();
    expect(valueOf(P.rising)).toBe(P.needsTime);
    expect(valueOf(P.moon)).toMatch(/^\S+ o \S+$/);
    expect(panel().getByText(P.moonWarning)).toBeVisible();

    await user.click(panel().getByText(P.chart));
    const planets = panel().getByRole('table', { name: P.planets });
    expect(within(planets).getAllByRole('row')).toHaveLength(11);
    expect(planets).not.toHaveTextContent('°');
    expect(panel().getByText(P.noTimeDegrees)).toBeVisible();
    expect(panel().queryByRole('table', { name: P.houses })).not.toBeInTheDocument();
  });

  it('with time and place: CR 1991-02-03 21:40 has Asc 29°40′ Virgo and MC 29°42′ Géminis', async () => {
    const user = userEvent.setup();
    await openClient({ birth_date: '1991-02-03', birth_time: '21:40', ...SAN_JOSE });
    expect(valueOf(P.rising)).toBe('Virgo');
    expect(panel().queryByText(P.dstWarning)).not.toBeInTheDocument();
    expect(panel().queryByText(P.wholeSign)).not.toBeInTheDocument();

    await user.click(panel().getByText(P.chart));
    const details = panel().getByText(P.chart).closest('details');
    if (!details) throw new Error('no chart');
    const chart = within(details);
    expect(valueOf(P.rising, chart)).toBe('29°40′ Virgo');
    expect(valueOf(P.mc, chart)).toBe('29°42′ Géminis');
    const houses = chart.getByRole('table', { name: P.houses });
    expect(within(houses).getAllByRole('row')).toHaveLength(13);
    expect(
      within(houses).getByRole('rowheader', { name: '1' }).nextElementSibling,
    ).toHaveTextContent('29°40′ Virgo');
    expect(chart.getByRole('table', { name: P.planets })).toHaveTextContent(
      /Sol\d+°\d{2}′ Acuario/,
    );
  });

  it('warns when the birth time falls in a DST change', async () => {
    await openClient({ birth_date: '1979-02-25', birth_time: '00:30', ...SAN_JOSE });
    expect(panel().getByText(P.dstWarning)).toBeVisible();
  });

  it('says when houses fall back to whole signs', async () => {
    await openClient({
      birth_date: '1990-06-21',
      birth_time: '12:00',
      birth_lat: 69.6492,
      birth_lng: 18.9553,
      birth_tz: 'Europe/Oslo',
    });
    expect(panel().getByText(P.wholeSign)).toBeVisible();
  });

  it('updates when her birth data changes', async () => {
    const client = await openClient({ birth_date: '1990-08-10' });
    expect(valueOf(P.sun)).toBe('Leo');
    await repos.client.update(client.id, { birth_date: '1990-04-10' });
    expect(
      await panel().findByRole('heading', { level: 3, name: /Perfil de Aries/ }),
    ).toBeVisible();
  });
});
