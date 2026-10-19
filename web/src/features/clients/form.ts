import { z } from 'zod';

import type { Client } from '../../db';

/** Raw values as the form inputs hold them. */
export interface ClientFormValues {
  name: string;
  instagram: string;
  whatsapp: string;
  email: string;
  birth_date: string;
  birth_time: string;
  birth_time_unknown: boolean;
  birth_place_label: string;
  notes: string;
  tags: string;
}

/** The client fields the form edits. */
export type ClientFormFields = Pick<
  Client,
  | 'name'
  | 'instagram'
  | 'whatsapp'
  | 'email'
  | 'birth_date'
  | 'birth_time'
  | 'birth_place_label'
  | 'notes'
  | 'tags'
>;

/** i18n keys under `clients.form.error`. */
export type ClientFormErrorKey = 'nameRequired' | 'email';

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value));

export const clientFormSchema = z
  .object({
    name: z.string().trim().min(1, 'nameRequired'),
    // Stored without the `@`; the UI adds it back.
    instagram: optionalText.transform((value) => value?.replace(/^@+/, '') || null),
    whatsapp: optionalText,
    email: optionalText.refine((value) => value === null || z.email().safeParse(value).success, {
      message: 'email',
    }),
    birth_date: optionalText,
    birth_time: optionalText,
    birth_time_unknown: z.boolean(),
    birth_place_label: optionalText,
    notes: z.string().trim(),
    tags: z.string(),
  })
  .transform(({ birth_time_unknown, birth_time, tags, ...rest }): ClientFormFields => ({
    ...rest,
    // "No sabe la hora" is stored as null, never as midnight.
    birth_time: birth_time_unknown ? null : birth_time,
    tags: parseTags(tags),
  }));

export function parseTags(input: string): string[] {
  const tags = input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return [...new Set(tags)];
}

export type ClientFormResult =
  | { ok: true; fields: ClientFormFields }
  | { ok: false; errors: Partial<Record<keyof ClientFormValues, ClientFormErrorKey>> };

export function parseClientForm(values: ClientFormValues): ClientFormResult {
  const result = clientFormSchema.safeParse(values);
  if (result.success) return { ok: true, fields: result.data };
  const errors: Partial<Record<keyof ClientFormValues, ClientFormErrorKey>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ClientFormValues;
    errors[field] ??= issue.message as ClientFormErrorKey;
  }
  return { ok: false, errors };
}

export function emptyClientForm(): ClientFormValues {
  return {
    name: '',
    instagram: '',
    whatsapp: '',
    email: '',
    birth_date: '',
    birth_time: '',
    birth_time_unknown: false,
    birth_place_label: '',
    notes: '',
    tags: '',
  };
}

export function clientToForm(client: Client): ClientFormValues {
  return {
    name: client.name,
    instagram: client.instagram ?? '',
    whatsapp: client.whatsapp ?? '',
    email: client.email ?? '',
    birth_date: client.birth_date ?? '',
    birth_time: client.birth_time ?? '',
    // A saved birth date without a time means she marked "No sabe la hora".
    birth_time_unknown: client.birth_date !== null && client.birth_time === null,
    birth_place_label: client.birth_place_label ?? '',
    notes: client.notes,
    tags: client.tags.join(', '),
  };
}
