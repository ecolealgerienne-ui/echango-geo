import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { GeoConfigService } from '../config/geo-config.service';
import { ErrorCode } from '../errors/error-codes';
import { unauthorized } from '../errors/http-errors';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Défense en profondeur derrière la frontière réseau Docker (§7.1) : ce
 * service n'est joignable que depuis `echango_network`, et en plus chaque
 * appelant doit présenter le jeton partagé dans `X-Internal-Token`.
 *
 * ── Fail-closed ──────────────────────────────────────────────────────────
 *
 * Si `GEO_INTERNAL_TOKEN` est absent de l'environnement, ce guard refuse
 * **tout** — il ne « laisse pas passer parce qu'il n'y a rien à comparer ».
 * Un service d'authentification qu'une variable oubliée désactive en silence
 * est exactement le défaut que ce guard existe pour empêcher.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger(InternalTokenGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: GeoConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expected = this.config.internalToken;
    if (!expected) {
      this.logger.error('Requête refusée : GEO_INTERNAL_TOKEN non configuré (fail-closed).');
      unauthorized(ErrorCode.GEO_UNAUTHORIZED, 'Jeton interne non configuré côté service.');
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = request.headers['x-internal-token'];
    const token = Array.isArray(provided) ? provided[0] : provided;

    if (!token || !this.equal(token, expected)) {
      unauthorized(ErrorCode.GEO_UNAUTHORIZED, 'Jeton interne absent ou invalide.');
    }
    return true;
  }

  /**
   * Comparaison à temps constant. `timingSafeEqual` exige deux buffers de
   * même longueur — on hache d'abord en SHA-256 pour ne pas fuiter la
   * longueur du jeton attendu par le temps de réponse.
   */
  private equal(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
  }
}
