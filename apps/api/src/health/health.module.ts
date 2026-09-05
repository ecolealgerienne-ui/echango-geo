import { Module } from '@nestjs/common';
import { GeocodeModule } from '../geocode/geocode.module';
import { HealthController } from './health.controller';

@Module({
  imports: [GeocodeModule],
  controllers: [HealthController],
})
export class HealthModule {}
