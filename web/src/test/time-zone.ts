/**
 * Runs the enclosing `describe` block's tests with the process in `timeZone` (an IANA name),
 * as on a device set to it, and restores the original zone afterwards.
 */
// The app's tsconfig has no Node types; tests run in Node, where `TZ` is read on every change.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;

export function useTimeZone(timeZone: string): void {
  let original: string | undefined;
  beforeAll(() => {
    original = env.TZ;
    env.TZ = timeZone;
  });
  afterAll(() => {
    if (original === undefined) delete env.TZ;
    else env.TZ = original;
  });
}
