import { HttpStatus } from '@nestjs/common';
import { GeoConfigService } from '../common/config/geo-config.service';
import { ErrorCode } from '../common/errors/error-codes';
import { GeocodeService } from './geocode.service';
import {
  NominatimClient,
  NominatimRateLimitedError,
  NominatimUnavailableError,
} from './nominatim.client';

describe('GeocodeService', () => {
  let nominatim: { search: jest.Mock; reverse: jest.Mock };
  let service: GeocodeService;

  beforeEach(() => {
    process.env = {
      ...process.env,
      GEO_DEFAULT_COUNTRIES: 'dz',
      GEO_SUPPORTED_COUNTRIES: 'dz,ae',
    };
    nominatim = { search: jest.fn(), reverse: jest.fn() };
    service = new GeocodeService(
      nominatim as unknown as NominatimClient,
      new GeoConfigService(),
    );
  });

  it('search : pays absent → utilise GEO_DEFAULT_COUNTRIES', async () => {
    nominatim.search.mockResolvedValue([]);
    await service.search({ q: 'alger centre', limit: 5 });
    expect(nominatim.search).toHaveBeenCalledWith('alger centre', 'dz', 5);
  });

  it('search : country=dz,ae supporté → transmis tel quel', async () => {
    nominatim.search.mockResolvedValue([]);
    await service.search({ q: 'souk', country: 'dz,ae', limit: 3 });
    expect(nominatim.search).toHaveBeenCalledWith('souk', 'dz,ae', 3);
  });

  it('search : country=fr non configuré → geo.country_not_configured (400)', async () => {
    await expect(
      service.search({ q: 'paris', country: 'fr', limit: 5 }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: ErrorCode.GEO_COUNTRY_NOT_CONFIGURED },
    });
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('search : « rien trouvé » n’est pas une erreur', async () => {
    nominatim.search.mockResolvedValue([]);
    await expect(service.search({ q: 'zzzzz', limit: 5 })).resolves.toEqual({
      results: [],
    });
  });

  it('search : Nominatim injoignable → 503 geo.upstream_unavailable', async () => {
    nominatim.search.mockRejectedValue(new NominatimUnavailableError('ECONNREFUSED'));
    await expect(service.search({ q: 'alger', limit: 5 })).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { code: ErrorCode.GEO_UPSTREAM_UNAVAILABLE },
    });
  });

  it('search : Nominatim 429 → 503 geo.upstream_rate_limited', async () => {
    nominatim.search.mockRejectedValue(new NominatimRateLimitedError());
    await expect(service.search({ q: 'alger', limit: 5 })).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { code: ErrorCode.GEO_UPSTREAM_RATE_LIMITED },
    });
  });

  it('reverse : renvoie le Place du client tel quel', async () => {
    const place = { label: '', shortLabel: '', latitude: 36, longitude: 3 };
    nominatim.reverse.mockResolvedValue(place);
    await expect(service.reverse({ lat: 36, lon: 3 })).resolves.toBe(place);
  });

  it('reverse : Nominatim injoignable → 503, jamais un 200 à libellé vide', async () => {
    nominatim.reverse.mockRejectedValue(new NominatimUnavailableError('timeout'));
    await expect(service.reverse({ lat: 36, lon: 3 })).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { code: ErrorCode.GEO_UPSTREAM_UNAVAILABLE },
    });
  });
});
