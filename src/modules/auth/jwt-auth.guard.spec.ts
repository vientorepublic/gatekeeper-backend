import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { sign } from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const JWT_SECRET = 'test-secret';

  function createContext(request: {
    headers: Record<string, string | undefined>;
    params?: Record<string, string | undefined>;
    user?: unknown;
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  function makeGuard(
    overrides: Partial<{
      authenticateApiKey: jest.Mock<() => Promise<unknown>>;
      toIdentity: jest.Mock;
    }> = {},
  ) {
    return new JwtAuthGuard(
      {
        get: jest.fn((key: string) =>
          key === 'gateway.jwtSecret' ? JWT_SECRET : undefined,
        ),
      } as never,
      { toIdentity: overrides.toIdentity ?? jest.fn((c) => c) } as never,
      {
        authenticateApiKey:
          overrides.authenticateApiKey ??
          jest.fn<() => Promise<unknown>>().mockResolvedValue({
            id: 'user-1',
            subject: 'sub-1',
            provider: 'flowauth',
            email: 'test@example.com',
          }),
      } as never,
    );
  }

  it('throws when no credential is provided', async () => {
    const guard = makeGuard();
    const context = createContext({ headers: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('authenticates via x-api-key and sets user', async () => {
    const guard = makeGuard();
    const request = {
      headers: { 'x-api-key': 'gk_test_key' },
      user: undefined,
    };
    const context = createContext(request);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ userId: 'user-1', subject: 'sub-1' });
  });

  it('passes namespace param to authenticateApiKey when present', async () => {
    const authenticateApiKey = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({
        id: 'user-1',
        subject: 'sub-1',
        provider: 'flowauth',
        email: null,
      });
    const guard = makeGuard({ authenticateApiKey });
    const context = createContext({
      headers: { 'x-api-key': 'gk_key' },
      params: { namespace: 'orders' },
    });
    await guard.canActivate(context);
    expect(authenticateApiKey.mock.calls[0]).toEqual(['gk_key', 'orders']);
  });

  it('authenticates a valid JWT and sets user', async () => {
    const toIdentity = jest.fn().mockReturnValue({ subject: 'sub-1' });
    const guard = makeGuard({ toIdentity });
    const token = sign({ sub: 'sub-1' }, JWT_SECRET, {
      algorithm: 'HS256',
      audience: 'gatekeeper',
    });
    const request = {
      headers: { authorization: `Bearer ${token}` },
      user: undefined,
    };
    const context = createContext(request);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(toIdentity).toHaveBeenCalled();
    expect(request.user).toEqual({ subject: 'sub-1' });
  });

  it('throws UnauthorizedException for an invalid JWT', async () => {
    const guard = makeGuard();
    const context = createContext({
      headers: { authorization: 'Bearer invalid.jwt.token' },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
