import { describe, expect, it } from 'vitest';

import { cardsSeed } from '../cards.ts';
import { CARD_IMAGE_SIZES, cardImageUrl } from './card-images.ts';

describe('cardImageUrl', () => {
  it.each(CARD_IMAGE_SIZES)('resolves a %s image for every card key', (size) => {
    for (const { key } of cardsSeed.cards) {
      expect(cardImageUrl(key, size)).toMatch(new RegExp(`/cards/${size}/${key}\\.webp`));
    }
  });

  it('throws for an unknown card key', () => {
    expect(() => cardImageUrl('major-22', 'full')).toThrow(/major-22/);
  });
});
