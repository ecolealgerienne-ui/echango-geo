import { Injectable } from '@nestjs/common';
import { GeoConfigService } from '../common/config/geo-config.service';
import { ErrorCode } from '../common/errors/error-codes';
import { badRequest, serviceUnavailable } from '../common/errors/http-errors';
import { GeocodeReverseDto } from './dto/geocode-reverse.dto';
import { GeocodeSearchDto } from './dto/geocode-search.dto';
import {
  GeocodedPlace,
  NominatimClient,
  NominatimRateLimitedError,
  NominatimUnavailableError,
} from './nominatim.client';

/**
 * Logique métier du géocodage : résolution et contrôle des pays, puis
 * traduction des pannes de `NominatimClient` vers le contrat d'erreur HTTP de
 * ce service (§2.3).
 */
@Injectable()
export class GeocodeService {
  constructor(
    private readonly nominatim: NominatimClient,
    private readonly config: GeoConfigService,
  ) {}

  async search(dto: GeocodeSearchDto): Promise<{ results: GeocodedPlace[] }> {
    const countries = this.resolveCountries(dto.country);

    try {
      const results = await this.nominatim.search(
        dto.q,
        countries.join(','),
        dto.limit,
      );
      // 0 à `limit` éléments, jamais une erreur sur « rien trouvé » (§2.1).
      return { results };
    } catch (error) {
      throw this.translate(error);
    }
  }

  async reverse(dto: GeocodeReverseDto): Promise<GeocodedPlace> {
    try {
      // `NominatimClient.reverse` ne lève PAS pour un point inconnu — il rend
      // les coordonnées avec des champs vides. Il ne lève que si Nominatim
      // est injoignable, ce qui doit sortir en 503 et non en 200 (§2.2).
      return await this.nominatim.reverse(dto.lat, dto.lon);
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Liste de pays effective pour la requête. `country` absent → défauts de
   * config. Chaque code doit appartenir à `GEO_SUPPORTED_COUNTRIES`, sinon
   * `geo.country_not_configured` (§6.3) — jamais une recherche silencieuse
   * dans un extrait non importé.
   */
  private resolveCountries(raw?: string): string[] {
    const requested = raw
      ? raw.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
      : this.config.defaultCountries;

    const unsupported = requested.filter((c) => !this.config.isCountrySupported(c));
    if (unsupported.length > 0) {
      badRequest(
        ErrorCode.GEO_COUNTRY_NOT_CONFIGURED,
        `Pays non configuré(s) : ${unsupported.join(', ')}. ` +
          `Extraits disponibles : ${this.config.supportedCountries.join(', ')}.`,
      );
    }
    return requested;
  }

  private translate(error: unknown): never {
    if (error instanceof NominatimRateLimitedError) {
      serviceUnavailable(
        ErrorCode.GEO_UPSTREAM_RATE_LIMITED,
        'Le moteur de géocodage limite le débit. Réessayer plus tard.',
      );
    }
    if (error instanceof NominatimUnavailableError) {
      serviceUnavailable(
        ErrorCode.GEO_UPSTREAM_UNAVAILABLE,
        'Le moteur de géocodage est momentanément indisponible.',
      );
    }
    throw error;
  }
}
