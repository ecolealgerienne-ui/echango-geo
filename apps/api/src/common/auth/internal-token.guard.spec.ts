import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GeoConfigService } from '../config/geo-config.service';
import { InternalTokenGuard } from './internal-token.guard';

function ctx(headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalTokenGuard', () => {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

  function guardWith(token: string | undefined): InternalTokenGuard {
    process.env = { ...process.env, GEO_INTERNAL_TOKEN: token };
    return new InternalTokenGuard(reflector, new GeoConfigService());
  }

  it('laisse passer avec le bon jeton', () => {
    const guard = guardWith('s3cret');
    expect(guard.canActivate(ctx({ 'x-internal-token': 's3cret' }))).toBe(true);
  });

  it('refuse un jeton absent', () => {
    const guard = guardWith('s3cret');
    expect(() => guard.canActivate(ctx({}))).toThrow();
  });

  it('refuse un mauvais jeton', () => {
    const guard = guardWith('s3cret');
    expect(() => guard.canActivate(ctx({ 'x-internal-token': 'nope' }))).toThrow();
  });

  it('fail-closed : refuse tout si GEO_INTERNAL_TOKEN est absent', () => {
    const guard = guardWith(undefined);
    expect(() => guard.canActivate(ctx({ 'x-internal-token': 'quoi que ce soit' }))).toThrow();
  });

  it('laisse passer une route @Public() sans jeton', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    const guard = guardWith('s3cret');
    expect(guard.canActivate(ctx({}))).toBe(true);
  });
});
