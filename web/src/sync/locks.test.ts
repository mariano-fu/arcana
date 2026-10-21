import { createLocalLocks } from './locks';

describe('createLocalLocks', () => {
  it('runs callbacks for one name one at a time, in order, even after a failure', async () => {
    const locks = createLocalLocks();
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = locks.request('a', async () => {
      order.push('first start');
      await gate;
      order.push('first end');
      throw new Error('boom');
    });
    const second = locks.request('a', () => {
      order.push('second');
      return Promise.resolve(2);
    });
    const other = locks.request('b', () => {
      order.push('other name');
      return Promise.resolve();
    });
    await other;
    release();

    await expect(first).rejects.toThrow('boom');
    expect(await second).toBe(2);
    expect(order).toEqual(['first start', 'other name', 'first end', 'second']);
  });
});
