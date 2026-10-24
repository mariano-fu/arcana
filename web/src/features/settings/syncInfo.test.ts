import { SKEW_WARNING_MS, skewWarning } from './syncInfo';

describe('skewWarning', () => {
  it('stays quiet up to 2 minutes either way, and without a measurement', () => {
    expect(skewWarning(null)).toBeNull();
    expect(skewWarning(0)).toBeNull();
    expect(skewWarning(SKEW_WARNING_MS)).toBeNull();
    expect(skewWarning(-SKEW_WARNING_MS)).toBeNull();
  });

  it('warns above 2 minutes: a server ahead means the phone is behind', () => {
    expect(skewWarning(SKEW_WARNING_MS + 1)).toEqual({ direction: 'behind', minutes: 2 });
    expect(skewWarning(5 * 60_000 + 20_000)).toEqual({ direction: 'behind', minutes: 5 });
  });

  it('warns when the phone is ahead of the server', () => {
    expect(skewWarning(-(SKEW_WARNING_MS + 1))).toEqual({ direction: 'ahead', minutes: 2 });
    expect(skewWarning(-90 * 60_000)).toEqual({ direction: 'ahead', minutes: 90 });
  });
});
