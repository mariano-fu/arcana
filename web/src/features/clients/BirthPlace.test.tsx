import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { MAX_RESULTS } from '../../seed/cities';
import { clearDb, newClient } from './test-utils';

const form = es.clients.form;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const placeInput = () => screen.getByRole('combobox', { name: form.birthPlace });

async function pickCity(user: ReturnType<typeof userEvent.setup>, query: string, label: string) {
  await user.clear(placeInput());
  await user.type(placeInput(), query);
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(clearDb);

describe('birth place', () => {
  it('fills coordinates and timezone from a picked city', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.type(screen.getByLabelText(form.name), 'Ana Prueba');
    await pickCity(user, 'escazu', 'Escazú, San José');
    expect(placeInput()).toHaveValue('Escazú, San José');
    expect(screen.getByText(/^Coordenadas: 9\.\d+, -84\.\d+ · America\/Costa_Rica$/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: es.common.save }));

    await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' });
    const [saved] = await repos.client.list();
    expect(saved).toMatchObject({
      birth_place_label: 'Escazú, San José',
      birth_tz: 'America/Costa_Rica',
    });
    expect(saved?.birth_lat).toBeCloseTo(9.92, 1);
    expect(saved?.birth_lng).toBeCloseTo(-84.14, 1);
  });

  it('shows at most 8 suggestions, and picks one with the keyboard', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.type(placeInput(), 'san');
    const list = await screen.findByRole('listbox', { name: form.citySuggestions });
    expect(within(list).getAllByRole('option')).toHaveLength(MAX_RESULTS);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByText(/^Coordenadas: /)).toBeVisible();
  });

  it('scrolls the input to the top on focus, so the keyboard does not cover suggestions', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.click(placeInput());
    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    });
    scrollIntoView.mockRestore();
  });

  it('clears the coordinates when she edits the place after picking', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await pickCity(user, 'escazu', 'Escazú, San José');
    await user.type(placeInput(), ' centro');
    expect(screen.getByText(form.birthPlaceNoCoordinates)).toBeVisible();
  });

  it('keeps an older place label without coordinates and lets her pick a city', async () => {
    const user = userEvent.setup();
    const client = await repos.client.create(
      newClient({ name: 'Ana Prueba', birth_date: '1990-04-12', birth_place_label: 'Escazú' }),
    );

    renderAt(`/clients/${client.id}`);
    expect(
      await screen.findByText(new RegExp(`Escazú \\(${es.clients.detail.noCoordinates}\\)`)),
    ).toBeVisible();

    await user.click(screen.getByRole('link', { name: es.common.edit }));
    expect(await screen.findByRole('combobox', { name: form.birthPlace })).toHaveValue('Escazú');
    expect(screen.getByText(form.birthPlaceNoCoordinates)).toBeVisible();

    await pickCity(user, 'escazu', 'Escazú, San José');
    await user.click(screen.getByRole('button', { name: es.common.save }));

    await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' });
    expect(await repos.client.get(client.id)).toMatchObject({
      birth_place_label: 'Escazú, San José',
      birth_tz: 'America/Costa_Rica',
    });
    expect(screen.queryByText(new RegExp(es.clients.detail.noCoordinates))).not.toBeInTheDocument();
  });

  it('accepts manual coordinates and validates them', async () => {
    const user = userEvent.setup();
    renderAt('/clients/new');

    await user.type(screen.getByLabelText(form.name), 'Ana Prueba');
    await user.type(placeInput(), 'Finca en Dota');
    await user.click(screen.getByLabelText(form.birthPlaceManual));
    expect(screen.getByRole('textbox', { name: form.birthPlace })).not.toHaveAttribute('role');
    await user.type(screen.getByLabelText(form.birthLat), '95');
    await user.type(screen.getByLabelText(form.birthLng), '-83,95');
    await user.click(screen.getByRole('button', { name: es.common.save }));

    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText(form.error.lat)).toBeVisible();
    expect(screen.getByText(form.error.tz)).toBeVisible();

    await user.clear(screen.getByLabelText(form.birthLat));
    await user.type(screen.getByLabelText(form.birthLat), '9.66');
    await user.selectOptions(screen.getByLabelText(form.birthTz), 'America/Costa_Rica');
    await user.click(screen.getByRole('button', { name: es.common.save }));

    await screen.findByRole('heading', { level: 1, name: 'Ana Prueba' });
    const [saved] = await repos.client.list();
    expect(saved).toMatchObject({
      birth_place_label: 'Finca en Dota',
      birth_lat: 9.66,
      birth_lng: -83.95,
      birth_tz: 'America/Costa_Rica',
    });
  });
});
