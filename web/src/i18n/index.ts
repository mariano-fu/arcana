import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './locales/es.json';

export const defaultNS = 'translation';
export const resources = { es: { translation: es } } as const;

// Strings are bundled, not fetched, so they work offline.
void i18n.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  supportedLngs: ['es'],
  defaultNS,
  resources,
  interpolation: { escapeValue: false },
});

export default i18n;
