import { Injectable, Logger } from '@nestjs/common';
import { configNumber } from './config-number';

/**
 * Lecture typée de la configuration (§6.3 des specs) — rien en dur, tout par
 * env var, avec un repli journalisé plutôt qu'un plantage au démarrage pour
 * une faute de frappe dans `.env`.
 *
 * Les valeurs sont lues **une fois** à la construction : ce service est
 * `@Injectable()` singleton, et relire `process.env` par requête n'apporte
 * rien qu'un redémarrage ne fasse mieux.
 */
@Injectable()
export class GeoConfigService {
  private readonly logger = new Logger(GeoConfigService.name);

  /** Pays utilisés quand la requête ne précise pas `country`. */
  readonly defaultCountries: string[];

  /**
   * Liste fermée des extraits Geofabrik réellement importés dans Nominatim.
   * Une requête `country=fr` hors de cette liste est refusée en
   * `geo.country_not_configured` (§6.3) — pas cherchée en silence dans un
   * extrait qui n'existe pas.
   */
  readonly supportedCountries: string[];

  /** URL du conteneur Nominatim sur le réseau Docker interne. */
  readonly nominatimUrl: string;

  /** Requêtes par seconde autorisées par IP appelante (§2.4). */
  readonly rateLimitPerIp: number;

  /** Délai avant `geo.upstream_unavailable`. */
  readonly httpTimeoutMs: number;

  /**
   * Jeton partagé attendu dans `X-Internal-Token` (§7.1, §10). Absent, le
   * service ne plante pas mais **refuse toute requête** (fail-closed) :
   * démarrer avec l'authentification désactivée en silence serait le pire
   * des cas.
   */
  readonly internalToken: string;

  constructor() {
    const env = process.env;

    this.defaultCountries = this.parseCountryList(
      env.GEO_DEFAULT_COUNTRIES,
      'dz',
      'GEO_DEFAULT_COUNTRIES',
    );
    this.supportedCountries = this.parseCountryList(
      env.GEO_SUPPORTED_COUNTRIES,
      'dz,ae',
      'GEO_SUPPORTED_COUNTRIES',
    );
    this.nominatimUrl = (env.NOMINATIM_INTERNAL_URL || 'http://geo-nominatim:8080').replace(
      /\/+$/,
      '',
    );
    this.rateLimitPerIp = configNumber(env.GEO_RATE_LIMIT_PER_IP, 20, 'GEO_RATE_LIMIT_PER_IP', {
      minimum: 1,
      maximum: 10_000,
    });
    this.httpTimeoutMs = configNumber(env.GEO_HTTP_TIMEOUT_MS, 10_000, 'GEO_HTTP_TIMEOUT_MS', {
      minimum: 500,
      maximum: 120_000,
    });
    this.internalToken = (env.GEO_INTERNAL_TOKEN || '').trim();

    // ⚠️ Un `defaultCountries` hors de `supportedCountries` produirait un
    // `geo.country_not_configured` sur une requête qui n'a rien demandé —
    // une absence de config déguisée en erreur client. Le dire au démarrage.
    const defautsHorsListe = this.defaultCountries.filter(
      (c) => !this.supportedCountries.includes(c),
    );
    if (defautsHorsListe.length > 0) {
      this.logger.warn(
        `GEO_DEFAULT_COUNTRIES contient ${defautsHorsListe.join(', ')} absent(s) de ` +
          `GEO_SUPPORTED_COUNTRIES — ces pays échoueront en geo.country_not_configured`,
      );
    }

    if (!this.internalToken) {
      this.logger.error(
        'GEO_INTERNAL_TOKEN absent — le service refusera TOUTE requête (fail-closed). ' +
          'Renseigner un jeton partagé avec les backends appelants.',
      );
    }
  }

  /**
   * `country=fr` avec `GEO_SUPPORTED_COUNTRIES=dz,ae` → `false`. Comparaison
   * en ISO-2 minuscule des deux côtés.
   */
  isCountrySupported(code: string): boolean {
    return this.supportedCountries.includes(code.trim().toLowerCase());
  }

  private parseCountryList(brut: string | undefined, defaut: string, cle: string): string[] {
    const source = brut && brut.trim() !== '' ? brut : defaut;
    const codes = source
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0);

    const invalides = codes.filter((c) => !/^[a-z]{2}$/.test(c));
    if (invalides.length > 0) {
      this.logger.warn(
        `${cle} : entrées ignorées, pas un code ISO-2 — ${invalides.join(', ')}`,
      );
    }
    const valides = [...new Set(codes.filter((c) => /^[a-z]{2}$/.test(c)))];

    if (valides.length === 0) {
      this.logger.warn(`${cle} vide après nettoyage — repli sur « ${defaut} »`);
      return defaut
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0);
    }
    return valides;
  }
}
