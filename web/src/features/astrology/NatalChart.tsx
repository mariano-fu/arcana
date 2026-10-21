import { useTranslation } from 'react-i18next';

import { formatPosition, signName, type HousesResult } from '../../astro';
import type { NatalPlanet } from './natal';

const cellClass = 'border-b border-stone-200 py-2 pr-3 text-left';

/** Planets and, with time and place, ascendant, MC and house cusps (US-4.2). */
export default function NatalChart({
  planets,
  houses,
  moonLabel,
}: {
  planets: NatalPlanet[];
  houses: HousesResult | null;
  /** Replaces the Moon's sign when it is uncertain ("Cáncer o Leo"). */
  moonLabel: string | null;
}) {
  const { t } = useTranslation();
  const position = (planet: NatalPlanet) =>
    planet.planet === 'moon' && moonLabel !== null
      ? moonLabel
      : planet.longitude === null
        ? signName(planet.sign)
        : formatPosition(planet.longitude);

  return (
    <div className="flex flex-col gap-4">
      {houses && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
          <dt className="font-medium text-stone-700">{t('astro.panel.rising')}</dt>
          <dd>{formatPosition(houses.ascendant.longitude)}</dd>
          <dt className="font-medium text-stone-700">{t('astro.panel.mc')}</dt>
          <dd>{formatPosition(houses.mc.longitude)}</dd>
        </dl>
      )}

      <table className="w-full text-base">
        <caption className="text-left font-semibold">{t('astro.panel.planets')}</caption>
        <thead>
          <tr className="text-sm text-stone-600">
            <th scope="col" className={cellClass}>
              {t('astro.panel.planet')}
            </th>
            <th scope="col" className={cellClass}>
              {t('astro.panel.position')}
            </th>
          </tr>
        </thead>
        <tbody>
          {planets.map((planet) => (
            <tr key={planet.planet}>
              <th scope="row" className={`${cellClass} font-medium`}>
                {t(`astro.planet.${planet.planet}`)}
              </th>
              <td className={cellClass}>{position(planet)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Decision (T2.6 A5): cusps 1–12 only; no planets placed in houses yet. */}
      {houses && (
        <table className="w-full text-base">
          <caption className="text-left font-semibold">{t('astro.panel.houses')}</caption>
          <thead>
            <tr className="text-sm text-stone-600">
              <th scope="col" className={cellClass}>
                {t('astro.panel.house')}
              </th>
              <th scope="col" className={cellClass}>
                {t('astro.panel.position')}
              </th>
            </tr>
          </thead>
          <tbody>
            {houses.cusps.map((cusp, i) => (
              <tr key={i}>
                <th scope="row" className={`${cellClass} font-medium`}>
                  {i + 1}
                </th>
                <td className={cellClass}>{formatPosition(cusp.longitude)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
