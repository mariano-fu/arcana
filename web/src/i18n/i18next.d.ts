import 'i18next';

import type { defaultNS, resources } from './index';

// Type-checks t('...') keys against es.json.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['es'];
  }
}
