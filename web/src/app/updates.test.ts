import { UPDATE_CHECK_INTERVAL_MS, watchForUpdates } from './updates';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

let time = 0;
let stop: () => void = () => undefined;
const update = vi.fn<() => Promise<void>>();

beforeEach(() => {
  time = 0;
  update.mockReset().mockResolvedValue(undefined);
  stop = watchForUpdates({ update }, () => time);
});

afterEach(() => {
  stop();
  setVisibility('visible');
  setOnline(true);
});

function comeBack(after: number) {
  time += after;
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('watchForUpdates', () => {
  it('checks when the app comes back to the foreground, at most once an hour', () => {
    comeBack(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();

    comeBack(1);
    expect(update).toHaveBeenCalledTimes(1);

    comeBack(UPDATE_CHECK_INTERVAL_MS / 2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not check when hidden or offline', () => {
    time += UPDATE_CHECK_INTERVAL_MS;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setOnline(false);
    comeBack(0);
    expect(update).not.toHaveBeenCalled();

    setOnline(true);
    comeBack(0);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stops watching', () => {
    stop();
    comeBack(UPDATE_CHECK_INTERVAL_MS);
    expect(update).not.toHaveBeenCalled();
  });
});
