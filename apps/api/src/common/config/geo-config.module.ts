import { Global, Module } from '@nestjs/common';
import { GeoConfigService } from './geo-config.service';

/**
 * `@Global` : la config est lue par le guard, le client Nominatim et le
 * throttler — l'exporter partout évite de la ré-importer dans chaque module.
 */
@Global()
@Module({
  providers: [GeoConfigService],
  exports: [GeoConfigService],
})
export class GeoConfigModule {}
