import { _resetConfigNumberLog, configNumber } from './config-number';

describe('configNumber', () => {
  beforeEach(() => _resetConfigNumberLog());

  it('convertit une chaîne numérique', () => {
    expect(configNumber('20', 5, 'K')).toBe(20);
  });

  it('retombe sur le défaut quand la clé est absente', () => {
    expect(configNumber(undefined, 5, 'K')).toBe(5);
    expect(configNumber('', 5, 'K')).toBe(5);
    expect(configNumber('   ', 5, 'K')).toBe(5);
  });

  it('retombe sur le défaut pour une valeur illisible', () => {
    expect(configNumber('abc', 5, 'K')).toBe(5);
    expect(configNumber('Infinity', 5, 'K')).toBe(5);
  });

  it('refuse un type inattendu sans le convertir', () => {
    expect(configNumber(true, 5, 'K')).toBe(5);
    expect(configNumber([7], 5, 'K')).toBe(5);
    expect(configNumber({}, 5, 'K')).toBe(5);
  });

  it('refuse zéro et le négatif', () => {
    expect(configNumber('0', 5, 'K')).toBe(5);
    expect(configNumber('-3', 5, 'K')).toBe(5);
  });

  it('applique les bornes', () => {
    expect(configNumber('0.1', 5, 'K', { minimum: 1 })).toBe(5);
    expect(configNumber('99999', 5, 'K', { maximum: 100 })).toBe(5);
    expect(configNumber('50', 5, 'K', { minimum: 1, maximum: 100 })).toBe(50);
  });
});
