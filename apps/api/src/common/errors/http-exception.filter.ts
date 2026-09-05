import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode } from './error-codes';

/**
 * ⚠️ **`@Catch()` sans argument : TOUTES les exceptions, pas seulement les
 * HTTP.** Copie du filtre d'`echango-delivery`
 * (`common/filters/http-exception.filter.ts`).
 *
 * Une `TypeError`, une erreur Axios non enveloppée sortiraient sinon par le
 * gestionnaire par défaut de Nest, **sans `code`** — et le backend appelant,
 * qui teste `code` pour décider s'il réessaie, ne recevrait rien à
 * distinguer. Les refus délibérés portent tous leur code ; les vraies pannes
 * doivent en porter un aussi.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url: string; method: string }>();

    if (!(exception instanceof HttpException)) {
      const status = HttpStatus.INTERNAL_SERVER_ERROR;
      // ⚠️ Le message d'origine ne sort PAS : une erreur Axios cite l'URL
      // interne de Nominatim avec ses paramètres. Le détail va au journal, le
      // client reçoit un code stable.
      this.logger.error(
        `${request.method} ${request.url} — exception non HTTP`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'Une erreur inattendue est survenue.',
        code: ErrorCode.GEO_UNEXPECTED,
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse() as
      | string
      | { code?: string; message?: string | string[] };

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof body === 'string' ? body : (body.message ?? exception.message),
      // `code` relayé quand il est présent — une exception levée avec
      // `{ code, message }` ne doit pas le perdre en chemin.
      ...(typeof body === 'object' && typeof body.code === 'string'
        ? { code: body.code }
        : {}),
    };

    this.logger.warn(`${request.method} ${request.url} — ${status}`);
    response.status(status).json(errorResponse);
  }
}
