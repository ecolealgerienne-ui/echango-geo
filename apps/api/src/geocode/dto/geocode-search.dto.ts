import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Ex-`GeocodeQueryDto` d'`echango-delivery`, étendu de `country` et `limit`
 * (§2.1 des specs).
 */
export class GeocodeSearchDto {
  /**
   * Minimum trois caractères : en deçà, Nominatim renvoie du bruit —
   * contrainte déjà appliquée par `echango-delivery`.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  q: string;

  /**
   * Code ISO-2 minuscule, ou liste séparée par virgules (`dz`, `dz,ae`).
   * Absent → `GEO_DEFAULT_COUNTRIES`. La validation de forme est ici ;
   * l'appartenance à `GEO_SUPPORTED_COUNTRIES` est vérifiée dans le service
   * (elle dépend de la config, pas du DTO).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}(,[a-z]{2})*$/, {
    message: 'country doit être un code ISO-2 minuscule ou une liste (ex. « dz » ou « dz,ae »)',
  })
  country?: string;

  /** 1–10, défaut 5. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit: number = 5;
}
