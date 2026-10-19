/**
 * Replaces `target[name]` for a test, including properties jsdom doesn't have (e.g.
 * `navigator.share`, `URL.createObjectURL`). Returns a function that puts back the original,
 * or removes the property if there was none.
 */
export function stubProperty(target: object, name: string, value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(target, name, before);
    else Reflect.deleteProperty(target, name);
  };
}
