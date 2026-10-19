import type { MockInstance } from 'vitest';

import { stubProperty } from '../../test/stub-property';
import { saveTextFile } from './download';

const restores: (() => void)[] = [];
function stub(target: object, name: string, value: unknown) {
  restores.push(stubProperty(target, name, value));
}

let click: MockInstance<HTMLAnchorElement['click']>;
let downloaded: Blob | undefined;

beforeEach(() => {
  downloaded = undefined;
  stub(
    URL,
    'createObjectURL',
    vi.fn((blob: Blob) => {
      downloaded = blob;
      return 'blob:file';
    }),
  );
  stub(URL, 'revokeObjectURL', vi.fn());
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  click.mockRestore();
  while (restores.length > 0) restores.pop()?.();
});

describe('saveTextFile', () => {
  it('opens the share sheet with the file when the browser can share files', async () => {
    const canShare = vi.fn(() => true);
    const share = vi.fn(() => Promise.resolve());
    stub(navigator, 'canShare', canShare);
    stub(navigator, 'share', share);

    await saveTextFile('pagos-2026-10.csv', 'a;b\r\n', 'text/csv');

    expect(share).toHaveBeenCalledOnce();
    const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('pagos-2026-10.csv');
    expect(files[0]?.type).toBe('text/csv');
    expect(await files[0]?.text()).toBe('a;b\r\n');
    expect(canShare).toHaveBeenCalledWith({ files });
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads when the browser has no Web Share API', async () => {
    await saveTextFile('pagos-2026-10.csv', 'a;b\r\n', 'text/csv');

    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('pagos-2026-10.csv');
    expect(link.href).toBe('blob:file');
    expect(await downloaded?.text()).toBe('a;b\r\n');
    expect(link.isConnected).toBe(false);
  });

  it("downloads when the browser can't share files", async () => {
    const share = vi.fn(() => Promise.resolve());
    stub(navigator, 'canShare', () => false);
    stub(navigator, 'share', share);

    await saveTextFile('pagos-2026-10.csv', 'a;b\r\n', 'text/csv');

    expect(share).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('does nothing more when she closes the share sheet', async () => {
    stub(navigator, 'canShare', () => true);
    stub(navigator, 'share', () => Promise.reject(new DOMException('cancelled', 'AbortError')));

    await saveTextFile('pagos-2026-10.csv', 'a;b\r\n', 'text/csv');

    expect(click).not.toHaveBeenCalled();
  });

  it('falls back to a download when sharing fails', async () => {
    stub(navigator, 'canShare', () => true);
    stub(navigator, 'share', () => Promise.reject(new DOMException('no', 'NotAllowedError')));

    await saveTextFile('pagos-2026-10.csv', 'a;b\r\n', 'text/csv');

    expect(click).toHaveBeenCalledOnce();
  });
});
