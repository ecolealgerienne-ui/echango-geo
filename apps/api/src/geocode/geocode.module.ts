import { Module } from '@nestjs/common';
import { GeocodeController } from './geocode.controller';
import { GeocodeService } from './geocode.service';
import { NominatimClient } from './nominatim.client';

@Module({
  controllers: [GeocodeController],
  providers: [GeocodeService, NominatimClient],
  exports: [NominatimClient],
})
export class GeocodeModule {}
