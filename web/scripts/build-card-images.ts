// Downloads the 1909 Rider-Waite-Smith scans from Wikimedia Commons, checks each file's
// description and license, and writes thumb + full WebP per card key plus CREDITS.md.
// Downloads are cached in web/.cache/card-scans/ (gitignored).
// Usage: npm run build:card-images

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

import { cardsSeed } from '../src/seed/cards.ts';
import {
  cardImageSource,
  checkCommonsFile,
  CREDITS_PATH,
  IMAGE_SIZES,
  IMAGES_DIR,
  MAX_TOTAL_BYTES,
  renderCredits,
  stripHtml,
  type CardImageCredit,
  type CardImageSource,
  type CommonsFileInfo,
  type ImageSize,
} from './card-images.ts';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks automated clients to identify themselves.
const HEADERS = { 'User-Agent': 'arcana-card-images/1.0 (https://github.com/mariano-fu)' };
const CACHE_DIR = new URL('../.cache/card-scans/', import.meta.url);
// The scans carry the grain of century-old paper, which WebP spends most of its bytes on.
// A 3 px median filter on the scan removes the grain but keeps the ink lines; with it the
// set fits the 5 MB budget at these qualities.
const WEBP_QUALITY: Record<ImageSize, number> = { thumb: 70, full: 55 };

interface ImageInfoResponse {
  query: {
    pages: Record<
      string,
      {
        title: string;
        missing?: string;
        imageinfo?: {
          url: string;
          descriptionurl: string;
          extmetadata: Record<string, { value: string } | undefined>;
        }[];
      }
    >;
  };
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res;
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`GET ${url}: HTTP ${String(res.status)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function fetchInfo(
  sources: readonly CardImageSource[],
): Promise<Map<string, CommonsFileInfo>> {
  const infos = new Map<string, CommonsFileInfo>();
  // The API accepts up to 50 titles per request.
  for (let i = 0; i < sources.length; i += 50) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'ImageDescription|Artist|LicenseShortName|Credit',
      titles: sources
        .slice(i, i + 50)
        .map((s) => `File:${s.file}`)
        .join('|'),
    });
    const data = (await (
      await fetchWithRetry(`${API}?${params.toString()}`)
    ).json()) as ImageInfoResponse;
    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0];
      if (page.missing !== undefined || !info)
        throw new Error(`${page.title} not found on Commons`);
      const meta = (field: string): string => stripHtml(info.extmetadata[field]?.value ?? '');
      infos.set(page.title.replace(/^File:/, ''), {
        // Drop the utm_* tracking parameters Commons appends.
        url: info.url.split('?')[0] ?? info.url,
        pageUrl: info.descriptionurl,
        description: meta('ImageDescription'),
        artist: meta('Artist'),
        license: meta('LicenseShortName'),
        credit: meta('Credit'),
      });
    }
  }
  return infos;
}

async function downloadScan(credit: CardImageCredit): Promise<Buffer> {
  const cached = new URL(`${credit.key}.jpeg`, CACHE_DIR);
  try {
    return await readFile(cached);
  } catch {
    const scan = Buffer.from(await (await fetchWithRetry(credit.url)).arrayBuffer());
    await writeFile(cached, scan);
    return scan;
  }
}

const sources = cardsSeed.cards.map(cardImageSource);
const infos = await fetchInfo(sources);
const credits = sources.map((source): CardImageCredit => {
  const info = infos.get(source.file);
  if (!info) throw new Error(`No Commons metadata for File:${source.file}`);
  checkCommonsFile(source, info);
  return { ...source, ...info };
});

await mkdir(CACHE_DIR, { recursive: true });
let total = 0;
for (const credit of credits) {
  const scan = await downloadScan(credit);
  for (const size of Object.keys(IMAGE_SIZES) as ImageSize[]) {
    const dir = new URL(`cards/${size}/`, IMAGES_DIR);
    await mkdir(dir, { recursive: true });
    const out = new URL(`${credit.key}.webp`, dir);
    await sharp(scan)
      .median(3)
      .resize({ width: IMAGE_SIZES[size] })
      .webp({ quality: WEBP_QUALITY[size], effort: 6 })
      .toFile(out.pathname);
    total += (await stat(out)).size;
  }
}

await writeFile(CREDITS_PATH, renderCredits(credits));

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
console.log(
  `Wrote ${String(credits.length * 2)} WebP files (${mb(total)} MB) and ${CREDITS_PATH.pathname}`,
);
if (total > MAX_TOTAL_BYTES) {
  console.error(`Total ${mb(total)} MB exceeds the ${mb(MAX_TOTAL_BYTES)} MB budget`);
  process.exitCode = 1;
}
