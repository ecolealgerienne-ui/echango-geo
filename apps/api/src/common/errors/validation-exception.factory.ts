import { BadRequestException, ValidationError } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Sans ceci, un DTO invalide renvoie les messages `class-validator` bruts —
 * en anglais, sans `code`. Ici, tout échec de validation sort avec
 * `geo.invalid_query` et la liste des champs fautifs (§2.3). Même principe
 * que `validationExceptionFactory` d'`echango-delivery`.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fields = flatten(errors);
  return new BadRequestException({
    code: ErrorCode.GEO_INVALID_QUERY,
    message: 'Requête invalide.',
    fields,
  });
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) out.push(path);
    if (err.children?.length) out.push(...flatten(err.children, path));
  }
  return out;
}
