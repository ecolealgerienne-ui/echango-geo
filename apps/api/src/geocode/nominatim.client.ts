import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { GeoConfigService } from '../common/config/geo-config.service';

/**
 * Une adresse décomposée, telle que Nominatim la rend.
 *
 * ⚠️ **Forme reprise verbatim de
 * `echango-delivery/backend/bff/src/common/geocoding/geocoding.service.ts`**
 * (interface `GeocodedPlace` + méthode `toPlace()`), éprouvée sur des
 * adresses algériennes réelles le 30/07/2026. Déplacée, pas réécrite (§5 des
 * specs). Le contrat côté consommateurs ne change pas.
 *
 * ── Pourquoi décomposer plutôt que garder une chaîne ───────────────────────
 *
 * Le `display_name` de Nominatim est une phrase. Rangée entière dans un seul
 * champ, elle ne donne ni tri par commune, ni recherche par code postal, et
 * tout affichage court se réduit à redécouper ce que le géocodeur avait déjà
 * séparé.
 *
 * ⚠️ **Les noms de champs de Nominatim varient selon le pays**, et sa
 * documentation ne les énumère pas exhaustivement. Les chaînes de repli
 * ci-dessous sont ordonnées du plus précis au plus large.
 */
export interface GeocodedPlace {
  /** `display_name` entier, tel quel. */
  label: string;
  /** Ce qui désigne la porte : numéro, rue, quartier. */
  shortLabel: string;
  latitude: number;
  longitude: number;
  /** Numéro et rue. */
  street?: string;
  /** Quartier. */
  neighborhood?: string;
  /** Daïra. */
  district?: string;
  /** Commune. */
  city?: string;
  /** Wilaya. */
  province?: string;
  postalCode?: string;
  /** Code ISO-2 en majuscules, **et pas le nom du pays**. */
  country?: string;
}

/** Nominatim injoignable, timeout, ou réponse non exploitable. */
export class NominatimUnavailableError extends Error {
  constructor(cause: string) {
    super(`Nominatim injoignable : ${cause}`);
    this.name = 'NominatimUnavailableError';
  }
}

/**
 * Nominatim a répondu 429. Distinct d'un échec ordinaire : la seule réaction
 * juste est d'arrêter, pas d'insister — leçon payée par `crm` (§1.1).
 */
export class NominatimRateLimitedError extends Error {
  constructor() {
    super('Nominatim a répondu 429 (trop de requêtes)');
    this.name = 'NominatimRateLimitedError';
  }
}

/**
 * HTTP vers le conteneur Nominatim interne. Connaît le format de fil de
 * Nominatim ; ne connaît ni le contrat d'erreur HTTP de ce service ni la
 * notion de « pays supporté » — c'est le rôle de `GeocodeService`.
 *
 * ⚠️ **Plus de throttle 1100 ms.** C'était une contrainte de la politique
 * d'usage de l'instance **publique** d'OSM, pas une limite technique de
 * Nominatim (§2.4). Une fois self-hosté, il n'a plus lieu d'être.
 */
@Injectable()
export class NominatimClient {
  private readonly logger = new Logger(NominatimClient.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: GeoConfigService) {
    this.http = axios.create({
      baseURL: this.config.nominatimUrl,
      timeout: this.config.httpTimeoutMs,
      headers: {
        'User-Agent': 'echango-geo/1.0 (contact@echango.com)',
        'Accept-Language': 'fr',
      },
    });
  }

  /**
   * Recherche d'adresse à partir d'un texte libre.
   *
   * @param countryCodes liste ISO-2 minuscule séparée par virgules,
   *   transmise telle quelle à Nominatim (`countrycodes`). Sans elle,
   *   « rue de la Liberté » remonte d'abord des résultats européens.
   */
  async search(
    query: string,
    countryCodes: string,
    limit: number,
  ): Promise<GeocodedPlace[]> {
    if (query.trim().length < 3) return [];

    try {
      const { data } = await this.http.get('/search', {
        params: {
          q: query,
          format: 'jsonv2',
          addressdetails: 1,
          limit,
          countrycodes: countryCodes,
        },
      });
      return (Array.isArray(data) ? data : []).map((r: unknown) => this.toPlace(r));
    } catch (error) {
      throw this.classify(error, `recherche « ${query} »`);
    }
  }

  /**
   * Adresse correspondant à un point.
   *
   * ⚠️ **Deux « rien » à ne pas confondre** (§2.2) :
   *  - Nominatim répond 200 mais ne connaît pas le point (mer, zone non
   *    cartographiée) → renvoie les coordonnées telles quelles, champs texte
   *    vides. Le point reste valide, c'est le libellé qui manque.
   *  - Nominatim est injoignable → lève `NominatimUnavailableError`. Le
   *    service le traduira en `503`, jamais en `200` à libellé vide (sinon
   *    une panne serait indiscernable d'un point en mer).
   */
  async reverse(lat: number, lon: number): Promise<GeocodedPlace> {
    try {
      const { data } = await this.http.get('/reverse', {
        params: { lat, lon, format: 'jsonv2', addressdetails: 1 },
      });

      // `/reverse` rend `{ error: "Unable to geocode" }` en HTTP 200 quand il
      // ne trouve rien : ce n'est PAS une panne.
      if (!data || typeof data !== 'object' || 'error' in data) {
        return { label: '', shortLabel: '', latitude: lat, longitude: lon };
      }

      return { ...this.toPlace(data), latitude: lat, longitude: lon };
    } catch (error) {
      throw this.classify(error, `géocodage inverse (${lat},${lon})`);
    }
  }

  /** Sonde pour `/health` — rapporte, ne lève jamais. */
  async ping(): Promise<{ reachable: boolean }> {
    try {
      // `mediagis/nominatim` expose `/status.php` ; `format=json` rend
      // `{ "status": 0, "message": "OK" }` quand l'import est terminé.
      const { status } = await this.http.get('/status.php', {
        params: { format: 'json' },
        timeout: Math.min(this.config.httpTimeoutMs, 3000),
      });
      return { reachable: status >= 200 && status < 500 };
    } catch (error) {
      this.logger.warn(
        `Nominatim non joignable par /status.php : ${(error as Error).message}`,
      );
      return { reachable: false };
    }
  }

  private classify(error: unknown, contexte: string): Error {
    if (axios.isAxiosError(error)) {
      const code = error.response?.status;
      if (code === 429) {
        this.logger.warn(`${contexte} : Nominatim 429`);
        return new NominatimRateLimitedError();
      }
      this.logger.warn(
        `${contexte} : ${code ? `HTTP ${code}` : error.code ?? error.message}`,
      );
      return new NominatimUnavailableError(
        code ? `HTTP ${code}` : (error.code ?? error.message),
      );
    }
    this.logger.error(`${contexte} : erreur inattendue`, error as Error);
    return new NominatimUnavailableError((error as Error).message);
  }

  // ── Repris verbatim de `geocoding.service.ts` (echango-delivery) ──────────
  //
  // Correspondance établie sur un appel réel (Alger, 30/07/2026) :
  //   road     : Rue Larbi Tebessi     neighbourhood : Ali Mellah
  //   suburb   : Belcourt              city          : Alger
  //   county   : Daïra Sidi M'Hamed    state         : Alger
  //   postcode : 16000                 country_code  : dz
  //
  // Nominatim ne rend pas la commune ; `neighbourhood` et `suburb` coexistent
  // et diffèrent (n'en garder qu'un perdrait « Belcourt », par quoi un
  // transporteur situe l'adresse).
  private toPlace(raw: unknown): GeocodedPlace {
    const r = (raw ?? {}) as Record<string, any>;
    const a = (r.address ?? {}) as Record<string, any>;

    const first = (...values: unknown[]): string | undefined =>
      values.find((v) => typeof v === 'string' && v.trim().length > 0) as
        | string
        | undefined;

    // « 12 Rue X » : le numéro précède la voie en français.
    const street =
      [a.house_number, first(a.road, a.pedestrian, a.footway, a.path)]
        .filter((v) => typeof v === 'string' && v.length > 0)
        .join(' ') || undefined;

    const neighborhood = first(a.neighbourhood, a.quarter, a.suburb, a.city_district);
    const suburb = first(a.suburb, a.city_district);
    const district =
      suburb && suburb !== neighborhood ? suburb : first(a.county, a.state_district);

    const city = first(a.municipality, a.city, a.town, a.village, a.city_district);
    const province = first(a.state, a.region);

    return {
      label: r.display_name ?? '',
      shortLabel:
        street ??
        [neighborhood, suburb]
          .filter((v, i, all): v is string => Boolean(v) && all.indexOf(v) === i)
          .join(', '),
      latitude: Number(r.lat) || 0,
      longitude: Number(r.lon) || 0,
      street,
      neighborhood,
      district,
      city,
      province,
      postalCode: first(a.postcode),
      country:
        typeof a.country_code === 'string' ? a.country_code.toUpperCase() : undefined,
    };
  }
}
