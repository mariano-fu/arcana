import { masculineWords } from './gender-neutral';

describe('masculineWords', () => {
  it('detects masculine-only words outside the allowlist', () => {
    expect(masculineWords('Pérdida de fe en sí mismo.')).toContain('sí mismo');
    expect(masculineWords('Se siente seguro y tranquilo.')).toEqual(['seguro', 'tranquilo']);
    expect(masculineWords('Lo que el consultante desea.')).toEqual(['el consultante']);
    expect(masculineWords('Con el corazón abierto, al mismo tiempo.')).toEqual([]);
    expect(masculineWords('Inseguridad y desconfianza.')).toEqual([]);
    expect(masculineWords('La persona consultante.')).toEqual([]);
  });
});
