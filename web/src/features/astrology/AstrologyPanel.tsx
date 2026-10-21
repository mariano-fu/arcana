import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { signName } from '../../astro';
import type { Client } from '../../db';
import { natalView } from './natal';
import NatalChart from './NatalChart';
import SunProfile from './SunProfile';

function Note({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <p
      className={`text-base ${warning ? 'rounded-lg bg-amber-100 p-3 text-amber-950' : 'text-stone-600'}`}
    >
      {children}
    </p>
  );
}

/**
 * The client's astrology: sun profile from the date; Moon and planets once the place is known;
 * ascendant, Medio Cielo and houses once the time is known too. Says plainly what is missing.
 */
export default function AstrologyPanel({ client }: { client: Client }) {
  const { t } = useTranslation();
  const { birth_date, birth_time, birth_lat, birth_lng, birth_tz, birth_place_label } = client;
  const view = useMemo(
    () => natalView({ birth_date, birth_time, birth_lat, birth_lng, birth_tz, birth_place_label }),
    [birth_date, birth_time, birth_lat, birth_lng, birth_tz, birth_place_label],
  );
  const editLink = (
    <Link
      to={`/clients/${client.id}/edit`}
      className="flex min-h-11 items-center self-start text-base underline"
    >
      {t('astro.panel.edit')}
    </Link>
  );

  const { sun, moon, rising } = view.signs;
  if (view.case === 'noDate' || !sun) {
    return (
      <div className="flex flex-col gap-1">
        <Note>{t('astro.panel.missingDate')}</Note>
        {editLink}
      </div>
    );
  }

  const sunLabel =
    sun.alternative === null
      ? signName(sun.sign)
      : t('astro.panel.orSign', {
          sign: signName(sun.sign),
          alternative: signName(sun.alternative),
        });
  // Decision (T2.6 A2): an uncertain Moon shows both possible signs, with a warning.
  const moonLabel = view.moonOptions
    ? t('astro.panel.orSign', {
        sign: signName(view.moonOptions.start),
        alternative: signName(view.moonOptions.end),
      })
    : null;
  const keySigns: [string, string][] = [
    [t('astro.panel.sun'), sunLabel],
    [t('astro.panel.moon'), moonLabel ?? (moon ? signName(moon) : t('astro.panel.needsPlace'))],
    [
      t('astro.panel.rising'),
      rising
        ? signName(rising)
        : view.case === 'noTime'
          ? t('astro.panel.needsTime')
          : t('astro.panel.needsPlace'),
    ],
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl
        aria-label={t('astro.panel.keySigns')}
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base"
      >
        {keySigns.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-stone-700">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {/* Decision (T2.6 A4): the cusp follows clientSigns' date-only rule. */}
      {sun.alternative !== null && (
        <Note>
          {t('astro.panel.sunCusp', {
            sign: signName(sun.sign),
            alternative: signName(sun.alternative),
          })}
        </Note>
      )}
      {view.moonOptions && <Note warning>{t('astro.panel.moonWarning')}</Note>}
      {view.case === 'noPlace' && (
        <>
          <Note>
            {view.placeWithoutCoordinates
              ? t('astro.panel.noCoordinates')
              : t('astro.panel.noPlace')}
          </Note>
          {editLink}
        </>
      )}
      {view.case === 'noTime' && <Note>{t('astro.panel.noTime')}</Note>}
      {view.timeAdjusted && <Note warning>{t('astro.panel.dstWarning')}</Note>}
      {view.houses?.system === 'whole-sign' && <Note warning>{t('astro.panel.wholeSign')}</Note>}

      <SunProfile sign={sun.sign} />

      {/* Decision (T2.6 A1): the full chart is folded so Cristales stays close. */}
      {view.planets && (
        <details className="rounded-lg border border-stone-200 bg-white">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-medium">
            {t('astro.panel.chart')}
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {view.case === 'noTime' && <Note>{t('astro.panel.noTimeDegrees')}</Note>}
            <NatalChart planets={view.planets} houses={view.houses} moonLabel={moonLabel} />
          </div>
        </details>
      )}
    </div>
  );
}
