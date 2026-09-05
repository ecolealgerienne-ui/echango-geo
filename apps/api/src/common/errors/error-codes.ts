/**
 * Registre unique des codes d'erreur de ce service, namespace `geo.*`.
 *
 * Même discipline que `error-codes.ts` d'`echango-delivery` : `badRequest`,
 * `serviceUnavailable` et `unauthorized` (`http-errors.ts`) exigent un
 * `ErrorCode`, pas un `string` — un code absent d'ici est une erreur de
 * compilation, jamais un code muet découvert en recette.
 *
 * Le client de ce service est un backend (jamais une app mobile, §7.1 des
 * specs) : le `code` lui sert à décider s'il réessaie, journalise ou
 * remonte — d'où la séparation nette entre `400` (ta requête est fautive,
 * ne réessaie pas) et `503` (l'amont manque, réessaie plus tard).
 */
export const ErrorCode = {
  /**
   * DTO invalide. Déjà couvert par le `ValidationPipe` (whitelist +
   * forbidNonWhitelisted) ; ce code existe pour que le rare chemin qui lève
   * à la main reste dans le registre.
   */
  GEO_INVALID_QUERY: 'geo.invalid_query',

  /**
   * Nominatim injoignable ou timeout. **503, pas 400** : la requête du
   * client est valide, c'est l'amont qui manque — motif repris tel quel de
   * `http-errors.ts` d'`echango-delivery` (« un 4xx invite à ne pas
   * réessayer, ce qui est faux ici »).
   */
  GEO_UPSTREAM_UNAVAILABLE: 'geo.upstream_unavailable',

  /**
   * Nominatim répond 429. Ne devrait plus arriver une fois self-hosté (§2.4),
   * mais le code doit exister : `crm` a perdu 61 fiches faute de distinguer
   * ce cas d'un échec ordinaire (§1.1). 503 pour la même raison que
   * ci-dessus.
   */
  GEO_UPSTREAM_RATE_LIMITED: 'geo.upstream_rate_limited',

  /**
   * `country` demandé hors de `GEO_SUPPORTED_COUNTRIES` (§6.3). Refus
   * explicite plutôt qu'une recherche silencieuse dans un extrait non
   * importé — Nominatim répondrait « sans résultat », indiscernable d'une
   * adresse inconnue (règle 10 de l'écosystème : une absence de
   * configuration ne doit pas se déguiser en absence de résultat).
   */
  GEO_COUNTRY_NOT_CONFIGURED: 'geo.country_not_configured',

  /**
   * `X-Internal-Token` absent ou incorrect. Défense en profondeur derrière
   * la frontière réseau Docker (§7.1) : seuls des backends de
   * `echango_network` appellent ce service, le jeton partagé est la seconde
   * barrière.
   */
  GEO_UNAUTHORIZED: 'geo.unauthorized',

  /**
   * Panne non prévue : tout ce qui n'est pas une `HttpException`. Jamais
   * levé à la main — c'est le filet de `http-exception.filter.ts`. L'y
   * trouver dans un journal veut dire qu'un chemin d'erreur n'a pas été
   * prévu (même rôle que `SERVER_UNEXPECTED` d'`echango-delivery`).
   */
  GEO_UNEXPECTED: 'geo.unexpected',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
