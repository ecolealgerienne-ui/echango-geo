import { SetMetadata } from '@nestjs/common';

/**
 * Marque une route joignable **sans** `X-Internal-Token`. Réservé à
 * `/health` : la sonde doit répondre à l'orchestrateur, qui n'a pas de
 * raison de porter le jeton applicatif.
 */
export const IS_PUBLIC_KEY = 'geo:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
