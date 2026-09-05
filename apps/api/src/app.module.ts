import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { InternalTokenGuard } from './common/auth/internal-token.guard';
import { GeoConfigModule } from './common/config/geo-config.module';
import { GeoConfigService } from './common/config/geo-config.service';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { GeocodeModule } from './geocode/geocode.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GeoConfigModule,
    // Protection contre une boucle cliente, pas contre notre propre instance
    // (§2.4) : fenêtre d'une seconde, `GEO_RATE_LIMIT_PER_IP` requêtes.
    ThrottlerModule.forRootAsync({
      imports: [GeoConfigModule],
      inject: [GeoConfigService],
      useFactory: (config: GeoConfigService) => ({
        throttlers: [{ ttl: 1000, limit: config.rateLimitPerIp }],
      }),
    }),
    GeocodeModule,
    HealthModule,
  ],
  providers: [
    // Le jeton interne d'abord : une requête non authentifiée n'a pas à
    // consommer le compteur de débit.
    { provide: APP_GUARD, useClass: InternalTokenGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
