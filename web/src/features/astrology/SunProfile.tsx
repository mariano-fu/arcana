import { useTranslation } from 'react-i18next';

import { signName } from '../../astro';
import { zodiacSeed, type MonthDay, type SignKey } from '../../seed/zodiac';

/** `21 de marzo` (a fixed leap year, so 29 February formats too). */
function formatMonthDay({ month, day }: MonthDay): string {
  return new Intl.DateTimeFormat('es-CR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, month - 1, day)));
}

/** The sun sign's profile from the zodiac seed (US-4.1). Adds no interpretation of its own. */
export default function SunProfile({ sign }: { sign: SignKey }) {
  const { t } = useTranslation();
  const profile = zodiacSeed.signs.find((s) => s.key === sign);
  if (!profile) return null;

  const ruler = t(`astro.planet.${profile.ruler}`);
  const names = (keys: readonly SignKey[]) => keys.map(signName).join(', ');
  const facts: [string, string][] = [
    [t('astro.panel.element'), t(`cards.element.${profile.element}`)],
    [t('astro.panel.modality'), t(`zodiac.modality.${profile.modality}`)],
    [
      t('astro.panel.ruler'),
      // Provisional (T2.6 A6): modern ruler, with the traditional one when they differ.
      profile.ruler === profile.traditional_ruler
        ? ruler
        : t('astro.panel.rulerTraditional', {
            modern: ruler,
            traditional: t(`astro.planet.${profile.traditional_ruler}`),
          }),
    ],
    [t('astro.panel.traits'), profile.traits.join(', ')],
    [t('astro.panel.compatible'), names(profile.compatible)],
    // Provisional (T2.6 A7): the seed's challenging signs are shown too.
    [t('zodiac.field.challenging'), names(profile.challenging)],
  ];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="text-lg font-semibold">
        <span aria-hidden="true">{profile.glyph} </span>
        {t('astro.panel.profile', { sign: profile.name })}
      </h3>
      <p className="text-sm text-stone-600">
        {t('astro.panel.dates', {
          start: formatMonthDay(profile.start),
          end: formatMonthDay(profile.end),
        })}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-stone-700">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-base">{profile.description}</p>
    </div>
  );
}
