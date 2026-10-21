// Steps shared by the e2e specs, driven the way she uses the app: by role and visible label.

import type { Page } from '@playwright/test';

import { cardsSeed, es, expect, formatted, spreadsSeed, tr } from './support.ts';

export async function openClients(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: es.nav.label })
    .getByRole('link', { name: es.nav.clients })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: es.clients.title })).toBeVisible();
}

export interface NewClient {
  name: string;
  instagram?: string;
  whatsapp?: string;
  birthDate?: string;
  cityQuery?: string;
  city?: string;
}

/** From the client list: fills the form, saves, and lands on the client's page. */
export async function createClient(page: Page, client: NewClient): Promise<void> {
  await page.getByRole('link', { name: es.clients.add }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: es.clients.form.newTitle }),
  ).toBeVisible();

  await page.getByLabel(es.clients.form.name, { exact: true }).fill(client.name);
  if (client.instagram) {
    await page.getByLabel(es.clients.form.instagram).fill(client.instagram);
  }
  if (client.whatsapp) await page.getByLabel(es.clients.form.whatsapp).fill(client.whatsapp);
  if (client.birthDate) {
    await page.getByLabel(es.clients.form.birthDate).fill(client.birthDate);
    await page.getByLabel(es.clients.form.birthTimeUnknown).check();
  }
  if (client.cityQuery && client.city) {
    await page.getByRole('combobox', { name: es.clients.form.birthPlace }).fill(client.cityQuery);
    await page.getByRole('option', { name: client.city, exact: true }).click();
    await expect(page.getByText(/^Coordenadas: /)).toBeVisible();
  }

  await page.getByRole('button', { name: es.common.save }).click();
  await expect(page.getByRole('heading', { level: 1, name: client.name })).toBeVisible();
}

/** From the client's page: starts a session and lands on it. */
export async function startSession(page: Page, clientName: string): Promise<void> {
  await page.getByRole('button', { name: es.clients.detail.newSession }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: tr(es.sessions.title, { name: clientName }) }),
  ).toBeVisible();
}

/** Sets the session price (and currency) and waits until it is saved. */
export async function setPrice(
  page: Page,
  price: string,
  currency: 'CRC' | 'USD',
  expectedDisplay: string,
): Promise<void> {
  await page.getByLabel(es.sessions.field.currency).selectOption(currency);
  const input = page.getByLabel(es.sessions.field.price);
  await input.fill(price);
  await input.blur();
  await expect(
    page.getByText(formatted(tr(es.sessions.field.pricePreview, { amount: expectedDisplay }))),
  ).toBeVisible();
  await expect(page.getByText(es.sessions.save.saved, { exact: true })).toBeVisible();
}

/** On the payments page: the month's income, one item per currency. */
export function incomeItems(page: Page) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: es.payments.page.income.title }) })
    .getByRole('listitem');
}

export type PaymentMethodKey = keyof typeof es.payments.method;

/** Records a payment from the session page. */
export async function addPayment(
  page: Page,
  amount: string,
  method: Exclude<PaymentMethodKey, 'label'>,
): Promise<void> {
  await page.getByRole('button', { name: es.payments.section.add }).click();
  const form = page.getByRole('form', { name: es.payments.form.addTitle });
  await form.getByLabel(es.payments.field.amount).fill(amount);
  await form.getByRole('button', { name: es.payments.method[method] }).click();
  await form.getByRole('button', { name: es.common.save }).click();
  await expect(form).toBeHidden();
}

export const celticCross = (() => {
  const spread = spreadsSeed.spreads.find((s) => s.key === 'celtic-cross');
  if (!spread) throw new Error('celtic-cross missing from spreads.json');
  return spread;
})();

/** Major arcana 0–9, one per Celtic Cross position. */
export const celticCrossCards = cardsSeed.cards
  .filter((card) => card.arcana === 'major')
  .slice(0, celticCross.positions.length)
  .map((card) => card.name);

/** Position 2 (Desafío) gets its card reversed. */
export const REVERSED_POSITION = 2;

export const positionLabel = (index: number, name: string) =>
  tr(es.spreads.reading.position, { index, name });

export function placedLabel(index: number): string {
  const position = celticCross.positions[index - 1];
  const card = celticCrossCards[index - 1];
  if (!position || !card) throw new Error(`no position ${String(index)}`);
  return tr(es.spreads.reading.positionButton, {
    position: positionLabel(position.index, position.name),
    card: index === REVERSED_POSITION ? tr(es.spreads.reading.reversedCard, { card }) : card,
  });
}

/** From the session page: starts a Cruz Celta and places a card in each of its 10 positions. */
export async function readCelticCross(page: Page): Promise<void> {
  await page.getByRole('link', { name: es.sessions.readings.new }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: es.spreads.chooser.title }),
  ).toBeVisible();
  await page.getByRole('button', { name: new RegExp(celticCross.name) }).click();

  for (const position of celticCross.positions) {
    const label = positionLabel(position.index, position.name);
    const card = celticCrossCards[position.index - 1] ?? '';
    await page
      .getByRole('button', {
        name: tr(es.spreads.reading.positionButtonEmpty, { position: label }),
      })
      .click();
    const picker = page.getByRole('dialog', {
      name: tr(es.spreads.picker.title, { position: label }),
    });
    await picker.getByRole('searchbox', { name: es.spreads.picker.search }).fill(card);
    if (position.index === REVERSED_POSITION) {
      await picker.getByRole('button', { name: es.cards.field.reversed }).click();
    }
    await picker.getByRole('button', { name: card, exact: true }).click();
    await expect(picker).toBeHidden();
    // Placing a card opens that position's meaning panel; close it to go on.
    const meaning = page.getByRole('dialog', { name: label });
    await expect(meaning.getByRole('heading', { level: 3, name: card })).toBeVisible();
    await meaning.getByRole('button', { name: es.common.close }).click();
    await expect(meaning).toBeHidden();
    await expect(
      page.getByRole('button', { name: placedLabel(position.index), exact: true }),
    ).toBeVisible();
  }
}

/** On the reading page: every position shows its card, the reversed one marked. */
export async function expectCelticCrossPlaced(page: Page): Promise<void> {
  for (const position of celticCross.positions) {
    await expect(
      page.getByRole('button', { name: placedLabel(position.index), exact: true }),
    ).toBeVisible();
  }
}
