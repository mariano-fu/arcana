import { sessionIdFromPath } from './leave';

describe('sessionIdFromPath', () => {
  it('extracts the id from a session page path only', () => {
    expect(sessionIdFromPath('/sessions/abc')).toBe('abc');
    expect(sessionIdFromPath('/sessions/abc/')).toBe('abc');
    expect(sessionIdFromPath('/sessions')).toBeNull();
    expect(sessionIdFromPath('/clients/abc')).toBeNull();
    expect(sessionIdFromPath('/sessions/abc/readings')).toBeNull();
  });
});
