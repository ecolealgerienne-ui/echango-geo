import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/errors/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ── En-têtes de sécurité ────────────────────────────────────────────────
  //
  // Ce service ne rend que du JSON à des backends, jamais de HTML dans un
  // navigateur (§1.3). Les trois en-têtes qui comptent tiennent en quatre
  // lignes — même arbitrage que le BFF d'`echango-delivery`, sans `helmet`.
  app.use((_req: unknown, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.removeHeader('X-Powered-By');
    next();
  });

  // ── Confiance au proxy ──────────────────────────────────────────────────
  //
  // `ThrottlerGuard` clef son compteur sur `req.ip`. Derrière un proxy,
  // `req.ip` vaut l'IP du proxy — la même pour tout le monde — sauf si
  // `trust proxy` est réglé sur le NOMBRE de sauts. Jamais `true` : ça ferait
  // confiance à n'importe quel `X-Forwarded-For` forgé. Absente, la valeur
  // vaut 0, ce qui est juste tant qu'aucun proxy n'est en façade (le cas en
  // v1, §7.1 — pas de Traefik devant ce service).
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const hops = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : trustProxy);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`echango-geo à l'écoute sur le port ${port}`);
}

void bootstrap();
