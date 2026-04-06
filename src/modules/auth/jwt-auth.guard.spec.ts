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
