import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator';
import { NominatimClient } from '../geocode/nominatim.client';

/**
 * Sonde de disponibilité. Même discipline que
 * `echango-delivery/.../health/health.controller.ts` : **ne lève jamais** sur
 * l'état des moteurs internes, elle le **rapporte** (§5.1 des specs).
 *
 * ⚠️ **Nuance par rapport au patron d'`echango-delivery`.** Là-bas Fleetbase
 * est un tiers dont la panne dégrade sans bloquer. Ici, Nominatim est **le**
 * moteur que ce service expose : si `nominatim.reachable` est `false`, les
 * routes de §2 répondent `503` — mais `/health` reste `200` avec l'info
 * dedans. C'est à la supervision de décider quoi en faire, pas au conteneur
 * de se tuer pour une dépendance qu'un redémarrage ne répare pas.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly nominatim: NominatimClient) {}

  @Public()
  @Get()
  async check() {
    const nominatim = await this.nominatim.ping();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: {
        nominatim,
        // `null` = pas encore déployé (v1), pas une panne. Le routage (§3)
        // n'existera qu'en v2.
        osrm: { reachable: null },
      },
    };
  }
}
