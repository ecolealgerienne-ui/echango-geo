import axios from 'axios';
import { GeoConfigService } from '../common/config/geo-config.service';
import {
  NominatimClient,
  NominatimRateLimitedError,
  NominatimUnavailableError,
} from './nominatim.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

// Réponse réelle Nominatim (Alger, 30/07/2026), forme documentée dans
// geocoding.service.ts d'echango-delivery.
const ALGER = {
  display_name:
    'Rue Larbi Tebessi, Ali Mellah, Belcourt, Alger, Daïra Sidi M\'Hamed, Alger, 16000, Algérie',
  lat: '36.7538',
  lon: '3.0588',
  address: {
    road: 'Rue Larbi Tebessi',
    neighbourhood: 'Ali Mellah',
    suburb: 'Belcourt',
    city: 'Alger',
    county: "Daïra Sidi M'Hamed",
    state: 'Alger',
    postcode: '16000',
    country_code: 'dz',
  },
};

describe('NominatimClient', () => {
  let get: jest.Mock;
  let client: NominatimClient;

  beforeEach(() => {
    get = jest.fn();
    mockedAxios.create.mockReturnValue({ get } as any);
    mockedAxios.isAxiosError.mockImplementation(
      (e: any) => Boolean(e?.isAxiosError),
    );
    process.env = { ...process.env, GEO_SUPPORTED_COUNTRIES: 'dz,ae' };
    client = new NominatimClient(new GeoConfigService());
  });

  it('décompose une adresse algérienne (toPlace verbatim)', async () => {
    get.mockResolvedValue({ status: 200, data: [ALGER] });

    const [place] = await client.search('Larbi Tebessi', 'dz', 5);

    expect(place).toMatchObject({
      shortLabel: 'Rue Larbi Tebessi',
      street: 'Rue Larbi Tebessi',
      neighborhood: 'Ali Mellah',
      district: 'Belcourt',
      city: 'Alger',
      province: 'Alger',
      postalCode: '16000',
      country: 'DZ',
      latitude: 36.7538,
      longitude: 3.0588,
    });
  });

  it('reverse : point inconnu (HTTP 200 + error) → coords, champs vides, pas de throw', async () => {
    get.mockResolvedValue({ status: 200, data: { error: 'Unable to geocode' } });

    const place = await client.reverse(36.5, -5.0);

    expect(place).toEqual({
      label: '',
      shortLabel: '',
      latitude: 36.5,
      longitude: -5.0,
    });
  });

  it('reverse : Nominatim injoignable → NominatimUnavailableError', async () => {
    get.mockRejectedValue({ isAxiosError: true, code: 'ECONNREFUSED' });

    await expect(client.reverse(36.75, 3.05)).rejects.toBeInstanceOf(
      NominatimUnavailableError,
    );
  });

  it('search : Nominatim 429 → NominatimRateLimitedError', async () => {
    get.mockRejectedValue({ isAxiosError: true, response: { status: 429 } });

    await expect(client.search('x y z', 'dz', 5)).rejects.toBeInstanceOf(
      NominatimRateLimitedError,
    );
  });

  it('ping : /status.php en échec → reachable false, jamais de throw', async () => {
    get.mockRejectedValue({ isAxiosError: true, code: 'ETIMEDOUT' });
    await expect(client.ping()).resolves.toEqual({ reachable: false });
  });
});
