import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';

/** Ex-`ReverseGeocodeQueryDto` d'`echango-delivery`, mêmes contraintes. */
export class GeocodeReverseDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lon: number;
}
