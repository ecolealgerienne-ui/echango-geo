import { Controller, Get, Query } from '@nestjs/common';
import { GeocodeReverseDto } from './dto/geocode-reverse.dto';
import { GeocodeSearchDto } from './dto/geocode-search.dto';
import { GeocodeService } from './geocode.service';

@Controller('v1/geocode')
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  /** `GET /v1/geocode/search?q=...&country=dz,ae&limit=5` (§2.1). */
  @Get('search')
  search(@Query() dto: GeocodeSearchDto) {
    return this.geocode.search(dto);
  }

  /** `GET /v1/geocode/reverse?lat=...&lon=...` (§2.2). */
  @Get('reverse')
  reverse(@Query() dto: GeocodeReverseDto) {
    return this.geocode.reverse(dto);
  }
}
