import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { loadSeed, seedId } from '../../seed/loader';
import { healthClaims } from '../../test/health-claims';
import { clearDb, newClient } from '../clients/test-utils';

const t = es.crystals.recommend;

async function openClient(overrides: Parameters<typeof newClient>[0] = {}) {
  const client = await repos.client.create(newClient(overrides));
  const router = createMemoryRouter(routes, { initialEntries: [`/clients/${client.id}`] });
  const view = render(<RouterProvider router={router} />);
  const heading = await screen.findByRole('heading', {
    level: 2,
    name: es.clients.detail.crystals,
  });
  const section = heading.closest('section');
  if (section === null) throw new Error('no crystals section');
  return { client, view, element: section, section: within(section) };
}

function crystalNames(section: HTMLElement): string[] {
  return within(section)
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent ?? '');
}

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

describe('crystal recommendations on client detail', () => {
  it('asks for a birth date or an intention when there is neither, with no list', async () => {
    const { section } = await openClient();

    expect(await section.findByText(t.empty)).toBeVisible();
    expect(section.queryAllByRole('listitem')).toHaveLength(0);
    for (const chip of section.getAllByRole('button')) {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('ranks by intention alone without a birth date', async () => {
    const user = userEvent.setup();
    const { section } = await openClient();

    await user.click(await section.findByRole('button', { name: es.crystals.intention.calm }));

    expect(section.queryByText(t.empty)).toBeNull();
    expect(section.getAllByRole('listitem')).toHaveLength(5);
    expect(section.getAllByText('Intención: Calma')).toHaveLength(5);
  });

  it('shows the top 5 for the sun sign, then 5 more per "Ver más"', async () => {
    const user = userEvent.setup();
    // 5 April: Aries, not a cusp; no place, so no Moon. The seed has 10 Aries crystals, all
    // scoring 2, so they sort by name.
    const { element, section } = await openClient({ birth_date: '1990-04-05' });

    await section.findByText(es.crystals.recommend.more);
    expect(crystalNames(element)).toEqual([
      'Aguamarina',
      'Aventurina verde',
      'Cianita azul',
      'Citrino',
      'Cornalina',
    ]);
    expect(section.getAllByText('Sol en Aries')).toHaveLength(5);

    await user.click(section.getByRole('button', { name: t.more }));
    expect(crystalNames(element)).toHaveLength(10);
    expect(section.queryByRole('button', { name: t.more })).toBeNull();
  });

  it('puts intention matches first, and resets to 5 when the intentions change', async () => {
    const user = userEvent.setup();
    const { element, section } = await openClient({ birth_date: '1990-04-05' });

    await user.click(await section.findByRole('button', { name: t.more }));
    const protection = section.getByRole('button', { name: es.crystals.intention.protection });
    await user.click(protection);

    expect(protection).toHaveAttribute('aria-pressed', 'true');
    expect(crystalNames(element)).toHaveLength(5);
    // Aries + Protección (2 + 3), by name.
    expect(crystalNames(element).slice(0, 3)).toEqual(['Hematita', 'Jaspe rojo', 'Pirita']);
    expect(section.getAllByText('Sol en Aries · Intención: Protección')).toHaveLength(3);
  });

  it('leaves out hidden crystals and uses her tag labels', async () => {
    const user = userEvent.setup();
    await repos.crystal.update(seedId('crystal', 'aquamarine'), { hidden: true });
    const [calm] = (await repos.intention_tag.list()).filter((tag) => tag.key === 'calm');
    if (calm === undefined) throw new Error('no calm tag');
    await repos.intention_tag.update(calm.id, { label: 'Paz' });
    const { element, section } = await openClient({ birth_date: '1990-04-05' });

    await user.click(await section.findByRole('button', { name: 'Paz' }));
    expect(crystalNames(element)).not.toContain('Aguamarina');
    expect(section.getAllByText(/Intención: Paz/).length).toBeGreaterThan(0);
  });

  it('does not save the chosen intentions', async () => {
    const user = userEvent.setup();
    const { client, view, section } = await openClient();

    await user.click(await section.findByRole('button', { name: es.crystals.intention.calm }));
    expect(await repos.client.get(client.id)).toEqual(client);
    view.unmount();

    const router = createMemoryRouter(routes, { initialEntries: [`/clients/${client.id}`] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(t.empty)).toBeVisible();
  });

  it('has no health claims in its texts', () => {
    expect(Object.values(t).flatMap(healthClaims)).toEqual([]);
  });
});
