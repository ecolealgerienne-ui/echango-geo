import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Point de passage unique pour lever une exception HTTP porteuse d'un `code`
 * stable, en plus du message français. Copie du patron d'`echango-delivery`
 * (`common/errors/http-errors.ts`), réduite aux trois formes que ce service
 * utilise.
 *
 * `code` est typé `ErrorCode` (`error-codes.ts`), pas `string` : une faute de
 * frappe est un refus de compiler, pas un code muet en production.
 */
export function badRequest(code: ErrorCode, message: string): never {
  throw new BadRequestException({ code, message });
}

export function unauthorized(code: ErrorCode, message: string): never {
  throw new UnauthorizedException({ code, message });
}

/**
 * 503, et non 400 : l'amont (Nominatim) est en panne, mais la requête du
 * client est parfaitement valide.
 *
 * Un `4xx` dit « ta requête est fautive », et un client raisonnable en
 * conclut qu'il est inutile de réessayer — exactement le mauvais message
 * quand la seule chose qui cloche est un moteur momentanément injoignable.
 * Un `503` dit « le service est indisponible, réessaie plus tard ». Motif
 * repris mot pour mot de `http-errors.ts` d'`echango-delivery`.
 */
export function serviceUnavailable(code: ErrorCode, message: string): never {
  throw new ServiceUnavailableException({ code, message });
}
