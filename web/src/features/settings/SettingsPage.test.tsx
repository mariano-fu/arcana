import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { cardsSeed } from '../../seed/cards';
import { loadSeed } from '../../seed/loader';
import { stubProperty } from '../../test/stub-property';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { formatBytes } from './storage';
import { appBuild, formatBuildDate } from './versions';

const S = es.settings;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const section = async (title: string) => within(await screen.findByRole('region', { name: title }));

let restore: (() => void) | undefined;

function stubStorage(storage: unknown) {
  restore = stubProperty(navigator, 'storage', storage);
}

beforeEach(async () => {
  await clearDb();
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('Ajustes', () => {
  it('opens from Inicio, and /about lands on it', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    await user.click(await screen.findByRole('link', { name: S.link }));
    expect(await screen.findByRole('heading', { level: 1, name: S.title })).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings');

    await router.navigate('/');
    await router.navigate('/about');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
    expect(await screen.findByRole('heading', { level: 1, name: S.title })).toBeVisible();
  });

  it('has storage, data check, backup, versions and about sections and no delete or reset buttons', async () => {
    renderAt('/settings');
    await section(S.storage.title);
    await section(S.dataCheck.title);
    await section(S.backup.title);
    await section(S.versions.title);
    await section(es.about.title);
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons.join(' ')).not.toMatch(/borrar|eliminar|restablecer/i);
  });
});

describe('Almacenamiento', () => {
  it('shows a persistent status with the space used, and no reminder', async () => {
    stubStorage({
      persisted: () => Promise.resolve(true),
      persist: vi.fn(),
      estimate: () => Promise.resolve({ usage: 12_400_000, quota: 2_000_000_000 }),
    });
    renderAt('/settings');
    const storage = await section(S.storage.title);
    expect(await storage.findByText('Estado: persistente')).toBeVisible();
    expect(
      storage.getByText(
        `Usa aproximadamente ${formatBytes(12_400_000)} de unos ${formatBytes(2_000_000_000)} disponibles.`,
      ),
    ).toBeVisible();
    expect(storage.queryByText(S.storage.backup)).not.toBeInTheDocument();
    expect(storage.queryByRole('button', { name: S.storage.retry })).not.toBeInTheDocument();
    expect(storage.getByText(S.storage.explain)).toBeVisible();
  });

  it('reminds her to keep a copy when not persistent, and asks again', async () => {
    const user = userEvent.setup();
    let granted = false;
    const persist = vi.fn(() => {
      granted = true;
      return Promise.resolve(true);
    });
    stubStorage({ persisted: () => Promise.resolve(granted), persist });
    renderAt('/settings');
    const storage = await section(S.storage.title);
    expect(await storage.findByText('Estado: no persistente')).toBeVisible();
    expect(storage.getByText(S.storage.backup)).toBeVisible();
    // No estimate() in this browser: the space line is left out.
    expect(storage.queryByText(/Usa aproximadamente/)).not.toBeInTheDocument();

    await user.click(storage.getByRole('button', { name: S.storage.retry }));
    expect(await storage.findByText('Estado: persistente')).toBeVisible();
    expect(persist).toHaveBeenCalledOnce();
    expect(storage.queryByText(S.storage.backup)).not.toBeInTheDocument();
  });

  it('says so when the browser cannot keep storage persistent', async () => {
    stubStorage(undefined);
    renderAt('/settings');
    const storage = await section(S.storage.title);
    expect(await storage.findByText(S.storage.unsupported)).toBeVisible();
    expect(storage.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Datos en este teléfono', () => {
  it('lists the phone, what is stored on it and the oldest dates', async () => {
    await db.meta.put({ key: 'device_id', value: '019a0c3e-4c00-7abc-8def-0123456789ab' });
    const client = await repos.client.create(newClient({ created_at: '2026-09-01T12:00:00.000Z' }));
    await repos.session.create(newSession(client.id, { started_at: '2026-09-02T15:00:00.000Z' }));
    renderAt('/settings');
    const data = await section(S.dataCheck.title);
    expect(
      await data.findByText(
        `Teléfono: 019a0c3e · desde ${formatBuildDate('2025-10-22T14:06:40.640Z')}`,
      ),
    ).toBeVisible();
    expect(data.getByText('Clientes: 1')).toBeVisible();
    expect(data.getByText('Sesiones: 1')).toBeVisible();
    expect(data.getByText('Pagos: 0')).toBeVisible();
    expect(data.getByText('Cristales propios o editados: 0')).toBeVisible();
    expect(
      data.getByText(`Cliente más antiguo: ${formatBuildDate('2026-09-01T12:00:00.000Z')}`),
    ).toBeVisible();
    expect(
      data.getByText(`Sesión más antigua: ${formatBuildDate('2026-09-02T15:00:00.000Z')}`),
    ).toBeVisible();
    expect(data.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows dashes on an empty database', async () => {
    renderAt('/settings');
    const data = await section(S.dataCheck.title);
    expect(await data.findByText('Teléfono: — · desde —')).toBeVisible();
    expect(data.getByText('Cliente más antiguo: —')).toBeVisible();
    expect(data.getByText('Sesión más antigua: —')).toBeVisible();
  });
});

describe('Versiones', () => {
  it('shows the build and the data versions on this device', async () => {
    await loadSeed(db);
    renderAt('/settings');
    const versions = await section(S.versions.title);
    expect(
      versions.getByText(new RegExp(`^Aplicación: versión ${appBuild.version} \\(`)),
    ).toBeVisible();
    expect(appBuild.version).toBe('0.1.0');
    expect(appBuild.commit).toMatch(/^([0-9a-f]{7}|dev)$/);
    expect(await versions.findByText(`Base de datos: versión ${String(db.verno)}`)).toBeVisible();
    expect(
      versions.getByText(
        new RegExp(
          `^Contenido: cartas ${String(cardsSeed.version)} · tiradas \\d+ · cristales \\d+$`,
        ),
      ),
    ).toBeVisible();
  });

  it('shows a dash for content not loaded yet', async () => {
    renderAt('/settings');
    const versions = await section(S.versions.title);
    expect(await versions.findByText(/tiradas — · cristales —$/)).toBeVisible();
  });
});

describe('Acerca de', () => {
  it('credits GeoNames under CC BY 4.0 and the 1909 card images', async () => {
    renderAt('/settings');
    const about = await section(es.about.title);
    expect(about.getByText(es.about.geonames)).toBeVisible();
    expect(about.getByRole('link', { name: es.about.geonamesLink })).toHaveAttribute(
      'href',
      'https://www.geonames.org/',
    );
    expect(about.getByRole('link', { name: es.about.licenseLink })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(about.getByText(es.about.cardImages)).toBeVisible();
  });

  it('lists third-party licences with their full text on demand', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    const about = await section(es.about.title);
    await user.click(about.getByRole('button', { name: es.about.licensesShow }));

    const react = await about.findByText('react', { selector: 'span' });
    const details = react.closest('details');
    if (!details) throw new Error('no licence entry for react');
    expect(within(details).getByText(/Permission is hereby granted/)).toBeInTheDocument();
    await user.click(react);
    expect(details).toHaveAttribute('open');
    expect(about.getByText('astronomy-engine', { selector: 'span' })).toBeVisible();
  });
});
