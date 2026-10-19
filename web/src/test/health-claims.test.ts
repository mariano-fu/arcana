import { healthClaims } from './health-claims';

describe('healthClaims', () => {
  it('detects cure and treatment words', () => {
    expect(healthClaims('Cura el insomnio.')).toEqual(['cura']);
    expect(healthClaims('Se usa para sanar heridas.')).toEqual(['sanar']);
    expect(healthClaims('Trata la ansiedad y alivia el dolor.')).toEqual([
      'trata',
      'alivia',
      'dolor',
    ]);
    expect(healthClaims('Previene enfermedades.')).toEqual(['enfermedades']);
    expect(healthClaims('Tiene propiedades curativas y terapéuticas.')).toEqual([
      'curativas',
      'terapéuticas',
    ]);
    expect(healthClaims('Una piedra de sanación.')).toEqual(['sanación']);
  });

  it('ignores words that only share letters', () => {
    expect(healthClaims('Despierta la curiosidad y la seguridad.')).toEqual([]);
    expect(healthClaims('Se asocia con la calma y el descanso.')).toEqual([]);
    expect(healthClaims('Tradicionalmente se usa para buscar claridad.')).toEqual([]);
    expect(healthClaims('Un retrato sanamente honesto.')).toEqual([]);
  });
});
