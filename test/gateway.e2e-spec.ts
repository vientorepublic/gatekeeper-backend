import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  All,
  Controller,
  Module,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { ApiKeysService } from '../src/modules/auth/api-keys.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { IdentityService } from '../src/modules/auth/identity.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { Oauth2Service } from '../src/modules/auth/oauth2.service';
import { GatewayProxyMiddleware } from '../src/modules/gateway/gateway-proxy.middleware';
import { ProxyStateService } from '../src/modules/gateway/proxy-state.service';
import { RouteRegistryService } from '../src/modules/gateway/route-registry.service';
import { HealthController } from '../src/modules/health/health.controller';
import { GatewayMetricsService } from '../src/modules/health/gateway-metrics.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type GatewayMetricsBody = {
  generatedAt: string;
  proxy: {
    total: number;
    upstream2xx: number;
    gateway5xx: number;
    payloadTooLarge: number;
    timeouts: number;
    circuitOpenRejections: number;
    inFlight: number;
    latencyMsAvg: number;
  };
  runtime: {
    memoryRssBytes: number;
    heapUsedBytes: number;
    eventLoopLagMsAvg: number;
  };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hasFiniteNumber = (obj: Record<string, unknown>, key: string): boolean =>
  isFiniteNumber(obj[key]);

const isGatewayMetricsBody = (value: unknown): value is GatewayMetricsBody => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.generatedAt !== 'string') {
    return false;
  }

  const proxy = value.proxy;
  if (!isRecord(proxy)) {
    return false;
  }

  const proxyFields = [
    'total',
    'upstream2xx',
    'gateway5xx',
    'payloadTooLarge',
    'timeouts',
    'circuitOpenRejections',
    'inFlight',
    'latencyMsAvg',
  ] as const;

  for (const field of proxyFields) {
    if (!hasFiniteNumber(proxy, field)) {
      return false;
    }
  }

  const runtime = value.runtime;
  if (!isRecord(runtime)) {
    return false;
  }

  const runtimeFields = [
    'memoryRssBytes',
    'heapUsedBytes',
    'eventLoopLagMsAvg',
  ] as const;
  return runtimeFields.every((field) => hasFiniteNumber(runtime, field));
};

const cacheStore = new Map<string, unknown>();

const cacheManagerMock = {
  get: <T>(key: string) =>
    Promise.resolve(cacheStore.get(key) as T | undefined),
  set: (key: string, value: unknown) => {
    cacheStore.set(key, value);
    return Promise.resolve();
  },
};

const configServiceMock = {
  get: (key: string) => {
    if (key === 'gateway.routeMap') {
      return {
        hashguard: {
          v1: 'http://hashguard.internal',
        },
        billing: 'http://billing.internal',
        unstable: 'http://unstable.internal',
        breaker: 'http://breaker.internal',
      };
    }

    if (key === 'gateway.oauth2Issuer') {
      return '';
    }

    if (key === 'gateway.maxProxyRequestBodyBytes') {
      return 8;
    }

    if (key === 'gateway.proxyTimeoutMs') {
      return 25;
    }

    if (key === 'gateway.proxyCircuitBreakerFailureThreshold') {
      return 2;
    }

    if (key === 'gateway.proxyCircuitBreakerCooldownMs') {
      return 60_000;
    }

    return undefined;
  },
};

const apiKeysServiceMock = {
  authenticateApiKey: jest.fn().mockResolvedValue({
    id: 'user-1',
    subject: 'subject-1',
    provider: 'flowauth',
    email: 'test@example.com',
  }),
};

@Controller('api/:namespace/:version')
class TestGatewayController {
  @All('*path')
  passthrough(): void {
    return;
  }
}

@Module({
  controllers: [TestGatewayController, HealthController],
  providers: [
    GatewayProxyMiddleware,
    RouteRegistryService,
    GatewayMetricsService,
    ProxyStateService,
    {
      provide: ConfigService,
      useValue: configServiceMock,
    },
    {
      provide: CACHE_MANAGER,
      useValue: cacheManagerMock,
    },
    {
      provide: ApiKeysService,
      useValue: apiKeysServiceMock,
    },
  ],
})
class GatewayTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GatewayProxyMiddleware).forRoutes(TestGatewayController);
  }
}

const oauth2ServiceMock = {
  createAuthorizationRequest: jest.fn().mockResolvedValue({
    authUrl: 'https://auth.example/authorize',
    state: 'state-123',
  }),
  completeAuthorizationCodeGrant: jest.fn().mockResolvedValue({
    accessToken: 'gateway-access-token',
    refreshToken: 'gateway-refresh-token',
    oauthAccessTokenExpiresIn: 3600,
    user: {
      id: 'user-1',
      provider: 'flowauth',
      subject: 'subject-1',
      email: 'test@example.com',
      name: 'Test User',
    },
  }),
  createSessionFromAccessToken: jest.fn().mockResolvedValue({
    accessToken: 'gateway-access-token',
    user: {
      id: 'user-1',
      provider: 'flowauth',
      subject: 'subject-1',
      email: 'test@example.com',
      name: 'Test User',
    },
  }),
  refreshSessionFromRefreshToken: jest.fn().mockResolvedValue({
    accessToken: 'gateway-access-token',
    refreshToken: 'gateway-refresh-token',
    oauthAccessTokenExpiresIn: 3600,
    user: {
      id: 'user-1',
      provider: 'flowauth',
      subject: 'subject-1',
      email: 'test@example.com',
      name: 'Test User',
    },
  }),
};

const authApiKeysServiceMock = {
  authenticateApiKey: jest.fn().mockResolvedValue({
    id: 'user-1',
    subject: 'subject-1',
    provider: 'flowauth',
    email: 'test@example.com',
  }),
  listApiKeys: jest.fn().mockResolvedValue([]),
  issueApiKey: jest.fn().mockResolvedValue({
    apiKey: {
      id: 'key-1',
      namespace: 'hashguard',
      keyPrefix: 'gk_prefix',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      label: null,
    },
    plainTextKey: 'gk_plain_text',
  }),
  revokeApiKey: jest.fn().mockResolvedValue(true),
};

const authConfigServiceMock = {
  get: (key: string) => {
    if (key === 'gateway.routeMap') {
      return {
        hashguard: {
          v1: 'http://hashguard.internal',
        },
      };
    }

    return undefined;
  },
};

@Module({
  controllers: [AuthController],
  providers: [
    JwtAuthGuard,
    {
      provide: Oauth2Service,
      useValue: oauth2ServiceMock,
    },
    {
      provide: ApiKeysService,
      useValue: authApiKeysServiceMock,
    },
    {
      provide: ConfigService,
      useValue: authConfigServiceMock,
    },
    {
      provide: IdentityService,
      useValue: {
        toIdentity: jest.fn((claims: { uid?: string }) => ({
          userId: claims.uid ?? 'user-1',
          subject: 'subject-1',
          provider: 'flowauth',
          scopes: [],
          email: 'test@example.com',
        })),
      },
    },
  ],
})
class AuthTestModule {}

describe('Gateway proxy e2e', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GatewayTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Mirror main.ts: suppress the X-Powered-By: Express header so the test
    // can assert that the gateway never leaks technology fingerprints to clients.
    (app as NestExpressApplication).disable('x-powered-by');
    await app.init();
  });

  beforeEach(() => {
    cacheStore.clear();
    apiKeysServiceMock.authenticateApiKey.mockClear();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      );
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not forward stale compression or connection-nominated response headers', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '999',
          connection: 'x-private',
          'x-private': 'secret',
        },
      }),
    );
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server)
      .get('/api/hashguard/v1/ping')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.headers['x-private']).toBeUndefined();
    expect(response.headers['content-length']).not.toBe('999');
  });

  it('forwards versioned namespace path tail correctly', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/hashguard/v1/health?deep=true')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    expect(apiKeysServiceMock.authenticateApiKey).toHaveBeenCalledWith(
      'gk_test_key',
      'hashguard',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://hashguard.internal/health?deep=true',
    );
  });

  it('keeps version prefix for direct namespace route target', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/billing/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    expect(apiKeysServiceMock.authenticateApiKey).toHaveBeenCalledWith(
      'gk_test_key',
      'billing',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://billing.internal/v1/health',
    );
  });

  it('rejects forwarding when authorization header is missing', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).get('/api/hashguard/v1/health').expect(401);

    expect(apiKeysServiceMock.authenticateApiKey).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects forwarding when bearer token is empty', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/hashguard/v1/health')
      .set('authorization', 'Bearer    ')
      .expect(401);

    expect(apiKeysServiceMock.authenticateApiKey).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when route mapping for namespace version does not exist', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/hashguard/v9/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(404);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 500 when upstream request fails', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockRejectedValueOnce(new Error('connection refused'));

    await request(server)
      .get('/api/hashguard/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(500)
      .expect('content-type', /application\/problem\+json/);
  });

  it('returns 413 when proxy request body exceeds configured limit', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/api/hashguard/v1/echo')
      .set('authorization', 'Bearer gk_test_key')
      .set('content-type', 'text/plain')
      .send('0123456789')
      .expect(413);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 500 with timeout error code when upstream fetch is aborted', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockImplementationOnce(
      (_input: string | URL | globalThis.Request, init?: RequestInit) => {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    );

    await request(server)
      .get('/api/unstable/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(500)
      .expect((res) => {
        const responseBody: unknown = res.body;

        expect(isRecord(responseBody)).toBe(true);
        if (!isRecord(responseBody)) {
          return;
        }

        expect(responseBody.errorCode).toBe('UPSTREAM_TIMEOUT');
      });
  });

  it('opens circuit after consecutive upstream failures', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockRejectedValue(new Error('upstream unavailable'));

    await request(server)
      .get('/api/breaker/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(500);

    await request(server)
      .get('/api/breaker/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(500);

    await request(server)
      .get('/api/breaker/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(503);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('strips leading slashes in tail path to prevent SSRF via protocol-relative URL', async () => {
    // Before the fix: tailPath "//evil.com" → new URL("//evil.com", base) hijacks the host.
    // After the fix:  normalizedTail = tailPath.replace(/^\/+/, '') → "evil.com"
    //                 upstreamUrl = new URL("/v1/evil.com", "http://billing.internal")
    //                            = "http://billing.internal/v1/evil.com" ✓
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/billing/v1///evil.com/steal')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('http://billing.internal/v1/evil.com/steal');
    expect(calledUrl).not.toMatch(/^https?:\/\/evil\.com/);
  });

  it('strips blocked upstream response headers before forwarding to client', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            // blocked headers that must be removed
            'set-cookie': 'session=supersecret; Path=/',
            server: 'nginx/1.21.0',
            'x-powered-by': 'Express',
            'access-control-allow-origin': 'https://attacker.example',
            'access-control-allow-credentials': 'true',
            // safe header that must be forwarded
            'x-request-id': 'trace-abc-123',
          },
        }),
      ),
    );

    const res = await request(server)
      .get('/api/hashguard/v1/data')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['server']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    // safe header must pass through
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('omits query string from error instance field to prevent token leakage', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockRejectedValueOnce(new Error('upstream down'));

    const res = await request(server)
      .get(
        '/api/hashguard/v1/oauth/callback?code=auth-code-secret&state=state-xyz',
      )
      .set('authorization', 'Bearer gk_test_key')
      .expect(500);

    const body = res.body as Record<string, unknown>;
    expect(typeof body.instance).toBe('string');
    const instance = body.instance as string;
    expect(instance).toBe('/api/hashguard/v1/oauth/callback');
    expect(instance).not.toContain('?');
    expect(instance).not.toContain('code');
    expect(instance).not.toContain('auth-code-secret');
  });

  it('exposes runtime proxy metrics at health metrics endpoint', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const response = await request(server).get('/health/metrics').expect(200);

    const responseBody: unknown = response.body;

    expect(isGatewayMetricsBody(responseBody)).toBe(true);
    if (!isGatewayMetricsBody(responseBody)) {
      return;
    }

    expect(responseBody.proxy.total).toBeGreaterThanOrEqual(1);
  });

  // --- Body size boundary ---

  it('returns 200 when POST body is exactly at the configured byte limit', async () => {
    // maxProxyRequestBodyBytes = 8; the guard is strict (>), so exactly 8 bytes is allowed.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/api/hashguard/v1/echo')
      .set('authorization', 'Bearer gk_test_key')
      .set('content-type', 'text/plain')
      .send('12345678') // 8 bytes — at the limit, not over
      .expect(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 413 when POST body is one byte over the configured byte limit', async () => {
    // 9 > 8 → PayloadTooLargeException is thrown before the upstream fetch is attempted.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/api/hashguard/v1/echo')
      .set('authorization', 'Bearer gk_test_key')
      .set('content-type', 'text/plain')
      .send('123456789') // 9 bytes — one over the limit
      .expect(413);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- Route resolution boundary ---

  it('returns 404 when the namespace does not exist in the route map', async () => {
    // Tests a completely unknown namespace (vs. a known namespace with unknown version).
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/completely-unknown-namespace/v1/health')
      .set('authorization', 'Bearer gk_test_key')
      .expect(404);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- Auth scheme boundary ---

  it('returns 401 when authorization header uses a non-Bearer scheme', async () => {
    // Basic auth credentials must not be accepted in place of a gateway API key.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/hashguard/v1/health')
      .set('authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);

    expect(apiKeysServiceMock.authenticateApiKey).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when the API key service rejects the provided key', async () => {
    // Simulates a revoked or otherwise invalid key being returned by the service layer.
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    apiKeysServiceMock.authenticateApiKey.mockRejectedValueOnce(
      new UnauthorizedException('Invalid or revoked API key'),
    );

    await request(server)
      .get('/api/hashguard/v1/health')
      .set('authorization', 'Bearer revoked_key')
      .expect(401);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // --- Upstream response passthrough ---

  it('forwards upstream 4xx status codes to the client unchanged', async () => {
    // The gateway must not swallow upstream error responses.
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await request(server)
      .get('/api/hashguard/v1/missing-resource')
      .set('authorization', 'Bearer gk_test_key')
      .expect(404);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards upstream 3xx redirect to the client without following it', async () => {
    // redirect: 'manual' means the gateway returns the raw 3xx + Location header
    // to the caller; the client is responsible for following the redirect.
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { location: 'https://new.location.example/path' },
        }),
      ),
    );

    const res = await request(server)
      .get('/api/hashguard/v1/old-path')
      .set('authorization', 'Bearer gk_test_key')
      .expect(301);

    expect(res.headers.location).toBe('https://new.location.example/path');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Auth e2e validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  beforeEach(() => {
    oauth2ServiceMock.createAuthorizationRequest.mockClear();
    oauth2ServiceMock.completeAuthorizationCodeGrant.mockClear();
    oauth2ServiceMock.createSessionFromAccessToken.mockClear();
    oauth2ServiceMock.refreshSessionFromRefreshToken.mockClear();
    authApiKeysServiceMock.authenticateApiKey.mockClear();
    authApiKeysServiceMock.listApiKeys.mockClear();
    authApiKeysServiceMock.issueApiKey.mockClear();
    authApiKeysServiceMock.revokeApiKey.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects oauth2 callback query when required fields are missing', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/auth/oauth2/callback?state=state-1')
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(
      oauth2ServiceMock.completeAuthorizationCodeGrant,
    ).not.toHaveBeenCalled();
  });

  it('rejects oauth2 session body when unknown property is provided', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({
        accessToken: 'token-1',
        unknownField: 'not-allowed',
      })
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(
      oauth2ServiceMock.createSessionFromAccessToken,
    ).not.toHaveBeenCalled();
  });

  it('rejects oauth2 session body when accessToken is blank', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({ accessToken: '   ' })
      .expect(400);

    expect(
      oauth2ServiceMock.createSessionFromAccessToken,
    ).not.toHaveBeenCalled();
  });

  it('accepts oauth2 session body and forwards only accessToken (scope ignored to prevent injection)', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({
        accessToken: '  token-abc  ',
        scope: '  openid profile  ',
      })
      .expect(201);

    // scope must NOT be forwarded to the service — it is intentionally stripped
    // to prevent caller-controlled scope injection into the issued gateway JWT.
    expect(oauth2ServiceMock.createSessionFromAccessToken).toHaveBeenCalledWith(
      'token-abc',
    );
    expect(
      oauth2ServiceMock.createSessionFromAccessToken.mock.calls[0],
    ).toHaveLength(1);
  });

  it('rejects api key issue when label exceeds max length', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/api-keys/hashguard')
      .set('x-api-key', 'gk_test_key')
      .send({ label: 'a'.repeat(129) })
      .expect(400);

    expect(authApiKeysServiceMock.issueApiKey).not.toHaveBeenCalled();
  });

  it('rejects api key revoke when id is not a UUID v4', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .delete('/auth/api-keys/hashguard/not-a-uuid')
      .set('x-api-key', 'gk_test_key')
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(authApiKeysServiceMock.revokeApiKey).not.toHaveBeenCalled();
  });

  it('returns 401 for GET /auth/namespaces when no credentials are provided', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).get('/auth/namespaces').expect(401);
  });

  it('returns namespace list for GET /auth/namespaces with valid x-api-key', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const res = await request(server)
      .get('/auth/namespaces')
      .set('x-api-key', 'gk_test_key')
      .expect(200);

    const body = res.body as { namespaces?: unknown };
    expect(Array.isArray(body.namespaces)).toBe(true);
  });

  // --- OAuth2 callback query boundary ---

  it('rejects oauth2 callback when only code is provided without state', async () => {
    // Symmetric case: the existing test covers only-state; this covers only-code.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/auth/oauth2/callback?code=authorization-code-value')
      .expect(400)
      .expect('content-type', /application\/problem\+json/);

    expect(
      oauth2ServiceMock.completeAuthorizationCodeGrant,
    ).not.toHaveBeenCalled();
  });

  // --- API key label length boundary ---

  it('accepts api key issue when label is at the max allowed length of 128 chars', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/api-keys/hashguard')
      .set('x-api-key', 'gk_test_key')
      .send({ label: 'a'.repeat(128) }) // at the limit, not over
      .expect(201);

    expect(authApiKeysServiceMock.issueApiKey).toHaveBeenCalledTimes(1);
  });

  it('accepts api key issue when label is an empty string (treated as absent)', async () => {
    // trimToUndefined converts '' → undefined; @IsOptional() accepts undefined.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/api-keys/hashguard')
      .set('x-api-key', 'gk_test_key')
      .send({ label: '' })
      .expect(201);

    expect(authApiKeysServiceMock.issueApiKey).toHaveBeenCalledTimes(1);
  });

  // --- OAuth2 session body boundary ---

  it('rejects oauth2 session body when the accessToken field is entirely absent', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).post('/auth/oauth2/session').send({}).expect(400);

    expect(
      oauth2ServiceMock.createSessionFromAccessToken,
    ).not.toHaveBeenCalled();
  });

  it('accepts oauth2 session body when accessToken is at the max allowed length of 8192 chars', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({ accessToken: 'a'.repeat(8192) })
      .expect(201);

    expect(
      oauth2ServiceMock.createSessionFromAccessToken,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects oauth2 session body when accessToken exceeds the max allowed length of 8192 chars', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({ accessToken: 'a'.repeat(8193) })
      .expect(400);

    expect(
      oauth2ServiceMock.createSessionFromAccessToken,
    ).not.toHaveBeenCalled();
  });

  // --- API key list pagination boundary ---

  it('rejects api key list when page query param is below the minimum value of 1', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/auth/api-keys/hashguard?page=0')
      .set('x-api-key', 'gk_test_key')
      .expect(400);

    expect(authApiKeysServiceMock.listApiKeys).not.toHaveBeenCalled();
  });

  it('rejects api key list when pageSize query param exceeds the maximum value of 100', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/auth/api-keys/hashguard?pageSize=101')
      .set('x-api-key', 'gk_test_key')
      .expect(400);

    expect(authApiKeysServiceMock.listApiKeys).not.toHaveBeenCalled();
  });

  it('accepts api key list when pageSize is exactly at the maximum allowed value of 100', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/auth/api-keys/hashguard?pageSize=100')
      .set('x-api-key', 'gk_test_key')
      .expect(200);

    expect(authApiKeysServiceMock.listApiKeys).toHaveBeenCalledTimes(1);
  });

  // --- OAuth2 refresh body boundary ---

  it('rejects oauth2 refresh body when the refreshToken field is absent', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).post('/auth/oauth2/refresh').send({}).expect(400);

    expect(
      oauth2ServiceMock.refreshSessionFromRefreshToken,
    ).not.toHaveBeenCalled();
  });

  it('rejects oauth2 refresh body when refreshToken is blank whitespace', async () => {
    // trimToString converts '   ' → ''; @IsNotEmpty() then fails.
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/refresh')
      .send({ refreshToken: '   ' })
      .expect(400);

    expect(
      oauth2ServiceMock.refreshSessionFromRefreshToken,
    ).not.toHaveBeenCalled();
  });

  // --- Route map endpoint boundary ---

  it('returns 401 for GET /auth/route-map when no credentials are provided', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).get('/auth/route-map').expect(401);
  });

  it('returns route guide with namespace and version details for GET /auth/route-map', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const res = await request(server)
      .get('/auth/route-map')
      .set('x-api-key', 'gk_test_key')
      .expect(200);

    const body = res.body as {
      namespaces?: Array<{
        namespace: string;
        supportsAnyVersion: boolean;
        versions: string[];
      }>;
    };
    expect(Array.isArray(body.namespaces)).toBe(true);
    const hashguard = body.namespaces?.find(
      (ns) => ns.namespace === 'hashguard',
    );
    expect(hashguard).toBeDefined();
    expect(hashguard?.supportsAnyVersion).toBe(false);
    expect(hashguard?.versions).toContain('v1');
  });
});

// Rate limiting security tests
// A dedicated module is used so the middleware is constructed with a low
// threshold (2 req / window) without affecting the main test module state.

const rateLimitConfigServiceMock = {
  get: (key: string) => {
    if (key === 'gateway.routeMap') {
      return { hashguard: { v1: 'http://hashguard.internal' } };
    }
    if (key === 'gateway.oauth2Issuer') return '';
    if (key === 'gateway.maxProxyRequestBodyBytes') return 1_048_576;
    if (key === 'gateway.proxyTimeoutMs') return 5_000;
    if (key === 'gateway.proxyCircuitBreakerFailureThreshold') return 10;
    if (key === 'gateway.proxyCircuitBreakerCooldownMs') return 60_000;
    // Low limits to make the test deterministic without sending 100 requests.
    if (key === 'gateway.rateLimitWindowMs') return 60_000;
    if (key === 'gateway.rateLimitMaxRequests') return 2;
    return undefined;
  },
};

const rateLimitApiKeysServiceMock = {
  authenticateApiKey: jest.fn().mockResolvedValue({
    id: 'user-1',
    subject: 'subject-1',
    provider: 'flowauth',
    email: 'test@example.com',
  }),
};

@Controller('api/:namespace/:version')
class RateLimitTestGatewayController {
  @All('*path')
  passthrough(): void {
    return;
  }
}

@Module({
  controllers: [RateLimitTestGatewayController],
  providers: [
    GatewayProxyMiddleware,
    RouteRegistryService,
    GatewayMetricsService,
    ProxyStateService,
    { provide: ConfigService, useValue: rateLimitConfigServiceMock },
    { provide: CACHE_MANAGER, useValue: cacheManagerMock },
    { provide: ApiKeysService, useValue: rateLimitApiKeysServiceMock },
  ],
})
class RateLimitTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(GatewayProxyMiddleware)
      .forRoutes(RateLimitTestGatewayController);
  }
}

describe('Gateway proxy rate limiting', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpiedFunction<typeof global.fetch>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RateLimitTestModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    (app as NestExpressApplication).disable('x-powered-by');
    await app.init();
  });

  beforeEach(() => {
    cacheStore.clear();
    rateLimitApiKeysServiceMock.authenticateApiKey.mockClear();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after request count exceeds configured rate limit within window', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    // First two requests should succeed (limit = 2).
    await request(server)
      .get('/api/hashguard/v1/ping')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    await request(server)
      .get('/api/hashguard/v1/ping')
      .set('authorization', 'Bearer gk_test_key')
      .expect(200);

    // Third request from the same IP must be rejected with 429 Too Many Requests.
    await request(server)
      .get('/api/hashguard/v1/ping')
      .set('authorization', 'Bearer gk_test_key')
      .expect(429);

    // Upstream must NOT have been called for the rejected request.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// JWT audience (`aud`) validation tests
// A dedicated module is used so the guard is constructed with a real
// JWT secret, allowing tokens to be signed and verified in-process.

const JWT_TEST_SECRET = 'e2e-test-jwt-secret-do-not-use-in-prod';

const jwtAudienceConfigServiceMock = {
  get: (key: string) => {
    if (key === 'gateway.jwtSecret') return JWT_TEST_SECRET;
    if (key === 'gateway.routeMap') {
      return { hashguard: { v1: 'http://hashguard.internal' } };
    }
    return undefined;
  },
};

const jwtAudienceApiKeysServiceMock = {
  authenticateApiKey: jest.fn().mockResolvedValue({
    id: 'user-1',
    subject: 'subject-1',
    provider: 'flowauth',
    email: 'test@example.com',
  }),
};

@Module({
  controllers: [AuthController],
  providers: [
    JwtAuthGuard,
    { provide: Oauth2Service, useValue: oauth2ServiceMock },
    { provide: ApiKeysService, useValue: jwtAudienceApiKeysServiceMock },
    { provide: ConfigService, useValue: jwtAudienceConfigServiceMock },
    {
      provide: IdentityService,
      useValue: {
        toIdentity: jest.fn((claims: { uid?: string }) => ({
          userId: claims.uid ?? 'user-1',
          subject: 'subject-1',
          provider: 'flowauth',
          scopes: [],
          email: 'test@example.com',
        })),
      },
    },
  ],
})
class JwtAudienceTestModule {}

describe('JWT audience validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtAudienceTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  beforeEach(() => {
    jwtAudienceApiKeysServiceMock.authenticateApiKey.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects Bearer JWT that has no aud claim', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const token = sign(
      { sub: 'user-1', uid: 'user-1', provider: 'flowauth' },
      JWT_TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    await request(server)
      .get('/auth/namespaces')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects Bearer JWT whose aud claim targets a different service', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const token = sign(
      {
        sub: 'user-1',
        uid: 'user-1',
        provider: 'flowauth',
        aud: 'other-service',
      },
      JWT_TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    await request(server)
      .get('/auth/namespaces')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('accepts Bearer JWT with aud claim set to gatekeeper', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const token = sign(
      { sub: 'user-1', uid: 'user-1', provider: 'flowauth', aud: 'gatekeeper' },
      JWT_TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    const res = await request(server)
      .get('/auth/namespaces')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { namespaces?: unknown };
    expect(Array.isArray(body.namespaces)).toBe(true);
  });

  it('rejects a JWT signed with a different secret even if aud is correct', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    const token = sign(
      { sub: 'user-1', uid: 'user-1', provider: 'flowauth', aud: 'gatekeeper' },
      'wrong-secret',
      { algorithm: 'HS256', expiresIn: '1h' },
    );

    await request(server)
      .get('/auth/namespaces')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });
});
