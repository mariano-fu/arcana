// What the Sincronización section shows (T3.8), as pure functions.

/** plan.md, "Clock skew": warn when the device and server clocks differ by more than this. */
export const SKEW_WARNING_MS = 2 * 60_000;

export interface SkewWarning {
  /** `behind`: the phone's clock is earlier than the server's. */
  direction: 'behind' | 'ahead';
  minutes: number;
}

/** `skewMs` is server clock minus device clock, as the engine stores it. */
export function skewWarning(skewMs: number | null): SkewWarning | null {
  if (skewMs === null || Math.abs(skewMs) <= SKEW_WARNING_MS) return null;
  return {
    direction: skewMs > 0 ? 'behind' : 'ahead',
    minutes: Math.round(Math.abs(skewMs) / 60_000),
  };
}
