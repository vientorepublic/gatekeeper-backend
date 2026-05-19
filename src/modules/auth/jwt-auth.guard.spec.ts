import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
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

  it('skips auth for public namespace gateway requests', async () => {
    const routeMap = {
      'public-api': {
        versions: { v1: 'http://public.internal' },
        public: true,
      },
    };

    const guard = new JwtAuthGuard(
      {
        get: jest.fn((key: string) =>
          key === 'gateway.routeMap' ? routeMap : undefined,
        ),
      } as never,
      { toIdentity: jest.fn() } as never,
      { authenticateApiKey: jest.fn() } as never,
    );

    const context = createContext({
      headers: {},
      params: {
        namespace: 'public-api',
        version: 'v1',
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('skips auth when request path matches a publicPaths rule', async () => {
    const routeMap = {
      api: {
        versions: { v1: 'http://api.internal' },
        publicPaths: [{ path: '/users/register', methods: ['POST'] }],
      },
    };

    const guard = new JwtAuthGuard(
      {
        get: jest.fn((key: string) =>
          key === 'gateway.routeMap' ? routeMap : undefined,
        ),
      } as never,
      { toIdentity: jest.fn() } as never,
      { authenticateApiKey: jest.fn() } as never,
    );

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          params: { namespace: 'api', version: 'v1' },
          url: '/api/api/v1/users/register',
          method: 'POST',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('requires auth when request path does not match publicPaths rule method', async () => {
    const routeMap = {
      api: {
        versions: { v1: 'http://api.internal' },
        publicPaths: [{ path: '/users/register', methods: ['POST'] }],
      },
    };

    const guard = new JwtAuthGuard(
      {
        get: jest.fn((key: string) =>
          key === 'gateway.routeMap' ? routeMap : undefined,
        ),
      } as never,
      { toIdentity: jest.fn() } as never,
      { authenticateApiKey: jest.fn() } as never,
    );

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          params: { namespace: 'api', version: 'v1' },
          url: '/api/api/v1/users/register',
          method: 'GET',
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('requires Bearer API key for gateway forwarding requests', async () => {
    const guard = new JwtAuthGuard(
      { get: jest.fn() } as never,
      { toIdentity: jest.fn() } as never,
      { authenticateApiKey: jest.fn() } as never,
    );

    const context = createContext({
      headers: {},
      params: {
        namespace: 'hashguard',
        version: 'v1',
      },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('authenticates Bearer API key with request namespace for gateway forwarding', async () => {
    const authenticateApiKey = jest.fn(() =>
      Promise.resolve({
        id: 'user-1',
        subject: 'subject-1',
        provider: 'flowauth',
        email: 'test@example.com',
      }),
    );

    const guard = new JwtAuthGuard(
      { get: jest.fn() } as never,
      { toIdentity: jest.fn() } as never,
      { authenticateApiKey } as never,
    );

    const request = {
      headers: {
        authorization: 'Bearer gk_test_key',
      },
      params: {
        namespace: 'hashguard',
        version: 'v1',
      },
      user: undefined,
    };

    const context = createContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticateApiKey.mock.calls[0]).toEqual([
      'gk_test_key',
      'hashguard',
    ]);
    expect(request.user).toEqual({
      userId: 'user-1',
      subject: 'subject-1',
      provider: 'flowauth',
      scopes: [],
      email: 'test@example.com',
    });
  });
});
