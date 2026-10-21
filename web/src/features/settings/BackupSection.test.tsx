import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, newId, repos } from '../../db';
import es from '../../i18n/locales/es.json';
import { stubProperty } from '../../test/stub-property';
import { FORMAT_VERSION } from '../backup/format';
import { at, backupWith, clientRow, stored } from '../backup/test-utils';
import { clearDb, newClient, newSession } from '../clients/test-utils';

const B = es.settings.backup;

let restores: (() => void)[] = [];
let share: ReturnType<typeof vi.fn<(data: { files: File[] }) => Promise<void>>>;

beforeEach(async () => {
  await clearDb();
  share = vi.fn(() => Promise.resolve());
  restores = [
    stubProperty(navigator, 'canShare', (data: { files?: File[] }) => data.files?.length === 1),
    stubProperty(navigator, 'share', share),
  ];
});

afterEach(() => {
  for (const restore of restores) restore();
  vi.restoreAllMocks();
});

async function openBackup() {
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });
  render(<RouterProvider router={router} />);
  return within(await screen.findByRole('region', { name: B.title }));
}

const jsonFile = (value: unknown, name = 'arcana-respaldo-2026-10-20.json') =>
  new File([JSON.stringify(value)], name, { type: 'application/json' });

describe('Respaldo: export', () => {
  it('shares the whole backup as a JSON file named by date', async () => {
    const client = await repos.client.create(newClient({ name: 'Cliente Exportada' }));
    await repos.session.create(newSession(client.id));
    const user = userEvent.setup();
    const section = await openBackup();

    const button = await section.findByRole('button', { name: B.export });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);

    await waitFor(() => {
      expect(share).toHaveBeenCalledOnce();
    });
    const file = share.mock.calls[0]?.[0].files[0];
    expect(file?.name).toMatch(/^arcana-respaldo-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file?.type).toBe('application/json');
    const backup = JSON.parse((await file?.text()) ?? '') as {
      format_version: number;
      tables: { client: { name: string }[]; session: unknown[] };
    };
    expect(backup.format_version).toBe(FORMAT_VERSION);
    expect(backup.tables.client.map((row) => row.name)).toEqual(['Cliente Exportada']);
    expect(backup.tables.session).toHaveLength(1);
    expect(section.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error instead of the share sheet when the export fails its check', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A session whose client doesn't exist: the file couldn't be imported back.
    await repos.session.create(newSession(newId()));
    const user = userEvent.setup();
    const section = await openBackup();

    const button = await section.findByRole('button', { name: B.export });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);

    expect(await section.findByRole('alert')).toHaveTextContent(B.exportError);
    expect(share).not.toHaveBeenCalled();
  });
});

describe('Respaldo: import', () => {
  it('previews the changes, imports on confirm and reports what was written', async () => {
    const mine = stored(clientRow(at(10), { name: 'Más reciente aquí' }), 0);
    await db.client.put(mine);
    const { pending, ...older } = { ...mine, name: 'Viejo', updated_at: at(1) };
    const incoming = clientRow(at(2), { name: 'Cliente Importada' });
    const user = userEvent.setup();
    const section = await openBackup();

    await user.upload(
      section.getByLabelText(B.import),
      jsonFile(backupWith({ client: [incoming, older] }, '2026-10-20T18:30:00.000Z')),
    );

    const preview = await section.findByRole('group', { name: /^Respaldo del / });
    expect(within(preview).getByText('Nuevos: 1')).toBeVisible();
    expect(within(preview).getByText('Se conserva la versión de este teléfono: 1')).toBeVisible();
    expect(within(preview).queryByText(B.future)).not.toBeInTheDocument();
    expect(await db.client.get(incoming.id)).toBeUndefined();

    await user.click(within(preview).getByRole('button', { name: B.confirm }));

    expect(await section.findByText(B.done)).toBeVisible();
    expect(section.getByText('Nuevos: 1')).toBeVisible();
    expect(await db.client.get(incoming.id)).toMatchObject({ name: 'Cliente Importada' });
    expect((await db.client.get(mine.id))?.name).toBe('Más reciente aquí');
  });

  it('writes nothing when she cancels', async () => {
    const user = userEvent.setup();
    const section = await openBackup();
    const incoming = clientRow(at(2));

    await user.upload(
      section.getByLabelText(B.import),
      jsonFile(backupWith({ client: [incoming] })),
    );
    const preview = await section.findByRole('group', { name: /^Respaldo del / });
    await user.click(within(preview).getByRole('button', { name: B.cancel }));

    expect(section.queryByRole('group')).not.toBeInTheDocument();
    expect(await db.client.count()).toBe(0);
  });

  it('warns about dates ahead of the phone’s clock', async () => {
    const user = userEvent.setup();
    const section = await openBackup();
    const ahead = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();

    await user.upload(
      section.getByLabelText(B.import),
      jsonFile(backupWith({ client: [clientRow(ahead)] })),
    );

    const preview = await section.findByRole('group', { name: /^Respaldo del / });
    expect(within(preview).getByText(B.future)).toBeVisible();
  });

  it.each<[string, unknown, string]>([
    [
      'a newer format',
      { ...backupWith({}), format_version: FORMAT_VERSION + 1 },
      B.error.futureVersion,
    ],
    ['another app’s file', { format: 'otra', format_version: 1 }, B.error.notBackup],
    [
      'invalid data',
      backupWith({ client: [{ ...clientRow(at(1)), archived: 'sí' as unknown as boolean }] }),
      'El respaldo tiene datos inválidos (1 problema). No se importó nada.',
    ],
  ])('explains in Spanish why %s is refused, and writes nothing', async (_, value, message) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const section = await openBackup();

    await user.upload(section.getByLabelText(B.import), jsonFile(value));

    expect(await section.findByRole('alert')).toHaveTextContent(message);
    expect(section.queryByRole('button', { name: B.confirm })).not.toBeInTheDocument();
    expect(await db.client.count()).toBe(0);
  });

  it('refuses a file that is not JSON', async () => {
    const user = userEvent.setup();
    const section = await openBackup();

    await user.upload(
      section.getByLabelText(B.import),
      new File(['no es json'], 'notas.json', { type: 'application/json' }),
    );

    expect(await section.findByRole('alert')).toHaveTextContent(B.error.notJson);
  });
});
