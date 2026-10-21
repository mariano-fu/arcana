import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../app/routes';
import { db, getDeviceId, repos, type Client } from '../../db';
import es from '../../i18n/locales/es.json';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { conflictRow } from './test-utils';

const C = es.conflicts;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

/** A client whose notes another device also edited. */
async function notesConflict(name = 'Ana', notes = 'Versión de acá') {
  const client = await repos.client.create(newClient({ name, notes }));
  await db.client.put({ ...client, pending: 0, server_version: 2 });
  const conflict = conflictRow('client', client.id, 'notes', { losing_value: 'Versión de allá' });
  await db.conflict.put(conflict);
  return { client, conflict };
}

const card = async (title: string) => within(await screen.findByRole('region', { name: title }));

beforeEach(async () => {
  await clearDb();
});

describe('where she finds them', () => {
  it('shows nothing on Inicio and no badge when there is nothing to review', async () => {
    renderAt('/');

    await screen.findByRole('heading', { level: 1, name: es.home.title });
    expect(screen.queryByText(C.inicio.title)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/por revisar/)).not.toBeInTheDocument();
  });

  it('shows an Inicio card and a badge on the Inicio tab, leading to Conflictos', async () => {
    await notesConflict();
    const router = renderAt('/');

    const inicio = await card(C.inicio.title);
    expect(inicio.getByText('Tiene 1 elemento por revisar.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: es.nav.label });
    expect(within(nav).getByLabelText('1 elemento por revisar')).toHaveTextContent('1');

    await userEvent.click(inicio.getByRole('link', { name: C.inicio.action }));
    expect(router.state.location.pathname).toBe('/conflicts');
    expect(await screen.findByRole('heading', { level: 1, name: C.title })).toBeInTheDocument();
  });
});

describe('Conflictos', () => {
  it('says so when there is nothing to review', async () => {
    renderAt('/conflicts');

    expect(await screen.findByText(C.empty)).toBeInTheDocument();
  });

  it('shows both versions; "Conservar la actual" resolves it and the badge goes away', async () => {
    const { client, conflict } = await notesConflict();
    renderAt('/conflicts');

    const group = await card('Notas · Ana');
    expect(group.getByText('Versión de acá')).toBeInTheDocument();
    expect(group.getByText('Versión de allá')).toBeInTheDocument();
    expect(group.getByText(/de otro dispositivo/)).toBeInTheDocument();

    await userEvent.click(group.getByRole('button', { name: C.keep }));

    expect(await screen.findByText(C.empty)).toBeInTheDocument();
    expect((await db.conflict.get(conflict.id))?.resolved).toBe(true);
    expect((await db.client.get(client.id))?.notes).toBe('Versión de acá');
    expect(screen.queryByLabelText(/por revisar/)).not.toBeInTheDocument();
  });

  it('"Usar esta" writes the other version into the field', async () => {
    const { client } = await notesConflict();
    renderAt('/conflicts');

    await userEvent.click((await card('Notas · Ana')).getByRole('button', { name: C.use }));

    await waitFor(async () => {
      expect((await db.client.get(client.id))?.notes).toBe('Versión de allá');
    });
    expect((await db.client.get(client.id))?.pending).toBe(1);
  });

  it('"Combinar" prefills both texts, lets her edit them and saves the result', async () => {
    const { client } = await notesConflict();
    renderAt('/conflicts');
    const group = await card('Notas · Ana');

    await userEvent.click(group.getByRole('button', { name: C.combine }));
    const editor = group.getByRole('textbox', { name: C.combined });
    expect(editor).toHaveValue('Versión de acá\n\nVersión de allá');
    await userEvent.type(editor, ' (revisado)');
    await userEvent.click(group.getByRole('button', { name: C.saveCombined }));

    await waitFor(async () => {
      expect((await db.client.get(client.id))?.notes).toBe(
        'Versión de acá\n\nVersión de allá (revisado)',
      );
    });
  });

  it('"Cancelar" leaves the combine editor without writing', async () => {
    const { client } = await notesConflict();
    renderAt('/conflicts');
    const group = await card('Notas · Ana');

    await userEvent.click(group.getByRole('button', { name: C.combine }));
    await userEvent.click(group.getByRole('button', { name: C.cancel }));

    expect(group.queryByRole('textbox')).not.toBeInTheDocument();
    expect((await db.client.get(client.id))?.notes).toBe('Versión de acá');
  });

  it('labels a version written on this device', async () => {
    const client = await repos.client.create(newClient({ name: 'Ana' }));
    await db.conflict.put(
      conflictRow('client', client.id, 'notes', { losing_device_id: await getDeviceId(db) }),
    );
    renderAt('/conflicts');

    expect((await card('Notas · Ana')).getByText(/de este dispositivo/)).toBeInTheDocument();
  });

  it('for a deleted row: copy the text or discard it, nothing else', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { client, conflict } = await notesConflict();
    await repos.client.remove(client.id);
    renderAt('/conflicts');

    const group = await card('Notas · Ana');
    expect(group.getByText(C.deleted.body)).toBeInTheDocument();
    expect(group.queryByRole('button', { name: C.keep })).not.toBeInTheDocument();
    expect(group.queryByRole('button', { name: C.use })).not.toBeInTheDocument();
    await userEvent.click(group.getByRole('button', { name: C.deleted.copy }));
    expect(writeText).toHaveBeenCalledWith('Versión de allá');
    expect(await group.findByRole('button', { name: C.deleted.copied })).toBeInTheDocument();

    await userEvent.click(group.getByRole('button', { name: C.deleted.discard }));

    expect(await screen.findByText(C.empty)).toBeInTheDocument();
    expect((await db.conflict.get(conflict.id))?.deleted_at).not.toBeNull();
  });

  it('for a row not synced here yet: shows it, with no actions', async () => {
    await db.conflict.put(conflictRow('client', crypto.randomUUID(), 'notes'));
    renderAt('/conflicts');

    expect(await screen.findByText(C.missing)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('for a field that is not free text: keep the current value only', async () => {
    const client = await repos.client.create(newClient({ name: 'Ana' }));
    const session = await repos.session.create(newSession(client.id, { price_minor: 2500000 }));
    await db.conflict.put(conflictRow('session', session.id, 'price_minor'));
    renderAt('/conflicts');

    expect(await screen.findByText(C.structured)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: C.keep })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: C.use })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: C.combine })).not.toBeInTheDocument();
  });
});

describe('Sesión de una ficha eliminada', () => {
  async function orphan(): Promise<{ client: Client; sessionId: string }> {
    const client = await repos.client.create(newClient({ name: 'Bea' }));
    const session = await repos.session.create(newSession(client.id));
    await db.client.put({ ...client, deleted_at: '2026-10-20T00:00:00.000Z', pending: 0 });
    return { client, sessionId: session.id };
  }

  it('"Restaurar la ficha" brings the client back', async () => {
    const { client } = await orphan();
    renderAt('/conflicts');

    const group = await card(C.orphan.title);
    expect(group.getByText(/La ficha de Bea se eliminó/)).toBeInTheDocument();
    await userEvent.click(group.getByRole('button', { name: C.orphan.restore }));

    expect(await screen.findByText(C.empty)).toBeInTheDocument();
    expect((await db.client.get(client.id))?.deleted_at).toBeNull();
  });

  it('"Eliminar la sesión" confirms, then deletes the session', async () => {
    const { client, sessionId } = await orphan();
    renderAt('/conflicts');

    await userEvent.click(
      (await card(C.orphan.title)).getByRole('button', { name: C.orphan.delete }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: es.sessions.delete.confirm,
      }),
    );

    expect(await screen.findByText(C.empty)).toBeInTheDocument();
    expect((await db.session.get(sessionId))?.deleted_at).not.toBeNull();
    expect((await db.client.get(client.id))?.deleted_at).not.toBeNull();
  });
});

it('shows no raw i18n keys', async () => {
  await notesConflict();
  renderAt('/conflicts');

  await card('Notas · Ana');
  expect(screen.queryByText(/^conflicts\./)).not.toBeInTheDocument();
});
