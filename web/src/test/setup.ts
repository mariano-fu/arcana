import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import '../i18n';

// jsdom does not implement scrolling; components call it (e.g. CityAutocomplete on focus).
// Node-environment tests (scripts/) have no DOM at all.
if (typeof Element !== 'undefined' && !('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => undefined,
    writable: true,
  });
}
