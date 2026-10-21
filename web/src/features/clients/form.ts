import { IANAZone } from 'luxon';
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
  /** Filled by picking a city, or typed in manual mode. */
  birth_lat: string;
  birth_lng: string;
  birth_tz: string;
  /** "Ingresar coordenadas manualmente": typing the place no longer clears the coordinates. */
  birth_place_manual: boolean;
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
  | 'birth_lat'
  | 'birth_lng'
  | 'birth_tz'
  | 'notes'
  | 'tags'
>;

/** i18n keys under `clients.form.error`. */
export type ClientFormErrorKey = 'nameRequired' | 'email' | 'lat' | 'lng' | 'tz';

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value));

/** Decimal degrees within ±`max`; accepts a comma as decimal separator. Empty → null. */
const coordinate = (max: number, message: ClientFormErrorKey) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : Number(value.replace(',', '.'))))
    .refine((value) => value === null || (Number.isFinite(value) && Math.abs(value) <= max), {
      message,
    });

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
    birth_lat: coordinate(90, 'lat'),
    birth_lng: coordinate(180, 'lng'),
    birth_tz: optionalText.refine((value) => value === null || IANAZone.isValidZone(value), {
      message: 'tz',
    }),
    // `birth_place_manual` is UI state only; z.object strips it from the result.
    notes: z.string().trim(),
    tags: z.string(),
  })
  // Coordinates are all or nothing: astrology needs latitude, longitude and timezone together.
  .superRefine(({ birth_lat, birth_lng, birth_tz }, ctx) => {
    const missing = (
      [
        ['birth_lat', birth_lat, 'lat'],
        ['birth_lng', birth_lng, 'lng'],
        ['birth_tz', birth_tz, 'tz'],
      ] as const
    ).filter(([, value]) => value === null);
    if (missing.length === 0 || missing.length === 3) return;
    for (const [path, , message] of missing)
      ctx.addIssue({ code: 'custom', path: [path], message });
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
    birth_lat: '',
    birth_lng: '',
    birth_tz: '',
    birth_place_manual: false,
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
    birth_lat: client.birth_lat === null ? '' : String(client.birth_lat),
    birth_lng: client.birth_lng === null ? '' : String(client.birth_lng),
    birth_tz: client.birth_tz ?? '',
    birth_place_manual: false,
    notes: client.notes,
    tags: client.tags.join(', '),
  };
}
