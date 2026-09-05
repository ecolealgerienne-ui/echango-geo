import { GeoConfigService } from './geo-config.service';

describe('GeoConfigService', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  function withEnv(env: Record<string, string | undefined>): GeoConfigService {
    process.env = { ...OLD, ...env };
    return new GeoConfigService();
  }

  it('applique les défauts documentés', () => {
    const c = withEnv({
      GEO_DEFAULT_COUNTRIES: undefined,
      GEO_SUPPORTED_COUNTRIES: undefined,
      NOMINATIM_INTERNAL_URL: undefined,
      GEO_RATE_LIMIT_PER_IP: undefined,
      GEO_HTTP_TIMEOUT_MS: undefined,
    });
    expect(c.defaultCountries).toEqual(['dz']);
    expect(c.supportedCountries).toEqual(['dz', 'ae']);
    expect(c.nominatimUrl).toBe('http://geo-nominatim:8080');
    expect(c.rateLimitPerIp).toBe(20);
    expect(c.httpTimeoutMs).toBe(10000);
  });

  it('normalise et dédoublonne les listes de pays', () => {
    const c = withEnv({ GEO_SUPPORTED_COUNTRIES: ' DZ , ae ,dz , FR ' });
    expect(c.supportedCountries).toEqual(['dz', 'ae', 'fr']);
  });

  it('ignore les entrées qui ne sont pas des codes ISO-2', () => {
    const c = withEnv({ GEO_SUPPORTED_COUNTRIES: 'dz,france,a,ae' });
    expect(c.supportedCountries).toEqual(['dz', 'ae']);
  });

  it('isCountrySupported compare en minuscule', () => {
    const c = withEnv({ GEO_SUPPORTED_COUNTRIES: 'dz,ae' });
    expect(c.isCountrySupported('DZ')).toBe(true);
    expect(c.isCountrySupported('fr')).toBe(false);
  });

  it('retire les slash finaux de l’URL Nominatim', () => {
    const c = withEnv({ NOMINATIM_INTERNAL_URL: 'http://geo-nominatim:8080///' });
    expect(c.nominatimUrl).toBe('http://geo-nominatim:8080');
  });

  it('retombe sur le défaut pour un débit illisible', () => {
    const c = withEnv({ GEO_RATE_LIMIT_PER_IP: 'beaucoup' });
    expect(c.rateLimitPerIp).toBe(20);
  });
});
