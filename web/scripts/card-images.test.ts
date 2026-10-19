// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cardsSeed } from '../src/seed/cards.ts';
import {
  cardImageSource,
  checkCommonsFile,
  CREDITS_PATH,
  IMAGE_SIZES,
  IMAGES_DIR,
  MAX_TOTAL_BYTES,
  renderCredits,
  type CommonsFileInfo,
  type ImageSize,
} from './card-images.ts';

const keys = cardsSeed.cards.map((card) => card.key);
const sizes = Object.keys(IMAGE_SIZES) as ImageSize[];
const sizeDir = (size: ImageSize): URL => new URL(`cards/${size}/`, IMAGES_DIR);

const commonsInfo = (overrides: Partial<CommonsFileInfo> = {}): CommonsFileInfo => ({
  url: 'https://upload.wikimedia.org/wikipedia/commons/6/6e/RWS1909_-_00_Fool.jpeg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:RWS1909_-_00_Fool.jpeg',
  description:
    'Fool card from the Waite–Smith Tarot deck. This card is from an original 1909 "Roses & Lilies" deck scanned by Saskia Jansen from her personal collection.',
  artist: 'Pamela Colman Smith',
  license: 'Public domain',
  credit: 'https://blog.goo.ne.jp/valet_de_coupe/e/10b39ab41d023e6b44bb7d7b7209c772',
  ...overrides,
});

describe('card image sources', () => {
  it('maps majors, pips and courts to the RWS1909 files on Commons', () => {
    const source = (key: string) => {
      const card = cardsSeed.cards.find((c) => c.key === key);
      if (!card) throw new Error(key);
      return cardImageSource(card);
    };
    expect(source('major-00')).toEqual({
      key: 'major-00',
      file: 'RWS1909 - 00 Fool.jpeg',
      englishName: 'Fool',
    });
    expect(source('major-08').englishName).toBe('Strength');
    expect(source('major-11').englishName).toBe('Justice');
    expect(source('cups-01')).toEqual({
      key: 'cups-01',
      file: 'RWS1909 - Cups 01.jpeg',
      englishName: 'Ace of Cups',
    });
    expect(source('swords-11').englishName).toBe('Page of Swords');
    expect(source('pentacles-14').file).toBe('RWS1909 - Pentacles 14.jpeg');
    expect(source('pentacles-14').englishName).toBe('King of Pentacles');
  });

  it('gives every card a distinct Commons file', () => {
    expect(new Set(cardsSeed.cards.map((c) => cardImageSource(c).file)).size).toBe(keys.length);
  });
});

describe('checkCommonsFile', () => {
  const fool = { key: 'major-00', file: 'RWS1909 - 00 Fool.jpeg', englishName: 'Fool' };

  it('accepts a public-domain scan of the original 1909 deck', () => {
    expect(() => {
      checkCommonsFile(fool, commonsInfo());
    }).not.toThrow();
  });

  it('rejects a file that does not state the original 1909 deck', () => {
    expect(() => {
      checkCommonsFile(
        fool,
        commonsInfo({ description: 'Fool card from the 1971 U.S. Games deck.' }),
      );
    }).toThrow(/original 1909/);
    expect(() => {
      checkCommonsFile(
        fool,
        commonsInfo({ description: 'Fool—“Pam-A” tarot card from the Rider–Waite Tarot deck.' }),
      );
    }).toThrow(/original 1909/);
  });

  it('rejects the wrong card, a non-public-domain license or another artist', () => {
    const magician = commonsInfo({
      description:
        'Magician card from the Waite–Smith Tarot deck. This card is from an original 1909 deck.',
    });
    expect(() => {
      checkCommonsFile(fool, magician);
    }).toThrow(/not for "Fool"/);
    expect(() => {
      checkCommonsFile(fool, commonsInfo({ license: 'CC BY-SA 4.0' }));
    }).toThrow(/license/);
    expect(() => {
      checkCommonsFile(fool, commonsInfo({ artist: 'Someone else' }));
    }).toThrow(/artist/);
  });
});

describe('generated card images', () => {
  it.each(sizes)('has a %s WebP for every card key in cards.es.json, and nothing else', (size) => {
    const files = readdirSync(sizeDir(size)).sort();
    expect(files).toEqual(keys.map((key) => `${key}.webp`).sort());
    for (const file of files) {
      const bytes = readFileSync(new URL(file, sizeDir(size)));
      // RIFF....WEBP container header.
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });

  it('adds at most 5 MB in total', () => {
    const total = sizes
      .flatMap((size) =>
        readdirSync(sizeDir(size)).map((f) => statSync(new URL(f, sizeDir(size))).size),
      )
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});

describe('CREDITS.md', () => {
  const credits = readFileSync(CREDITS_PATH, 'utf8');

  it('credits every card key with its Commons file and a public-domain license', () => {
    for (const card of cardsSeed.cards) {
      const { file } = cardImageSource(card);
      const row = credits.split('\n').find((line) => line.startsWith(`| \`${card.key}\` |`));
      expect(row, card.key).toBeDefined();
      expect(row).toContain(`[File:${file}](https://commons.wikimedia.org/wiki/File:`);
      expect(row).toContain('(https://upload.wikimedia.org/wikipedia/commons/');
      expect(row).toMatch(/\| Public domain \|$/);
      expect(row).not.toContain('utm_');
    }
  });

  it('matches what renderCredits produces from its own rows', () => {
    // Round-trip guard against hand edits: rows parsed back must render the same file.
    const rows = credits
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => {
        const m =
          /^\| `([^`]+)` \| (.+?) \| \[File:(.+?)\]\((.+?)\) \| \[original\]\((.+?)\) \| (.+) \|$/.exec(
            line,
          );
        if (!m) throw new Error(`Malformed row: ${line}`);
        const [, key = '', englishName = '', file = '', pageUrl = '', url = '', license = ''] = m;
        return { ...commonsInfo({ url, pageUrl, license }), key, englishName, file };
      });
    expect(renderCredits(rows)).toBe(credits);
  });
});
