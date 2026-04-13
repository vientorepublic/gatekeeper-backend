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
  ValidationPipe,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { ApiKeysService } from '../src/modules/auth/api-keys.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { IdentityService } from '../src/modules/auth/identity.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { Oauth2Service } from '../src/modules/auth/oauth2.service';
import { GatewayProxyMiddleware } from '../src/modules/gateway/gateway-proxy.middleware';
import { RouteRegistryService } from '../src/modules/gateway/route-registry.service';
import { HealthController } from '../src/modules/health/health.controller';
import { GatewayMetricsService } from '../src/modules/health/gateway-metrics.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type GatewayMetricsBody = {
  generatedAt: string;
  uptimeSeconds: number;
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

  if (
    typeof value.generatedAt !== 'string' ||
    !hasFiniteNumber(value, 'uptimeSeconds')
  ) {
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

    app = moduleRef.createNestApplication();
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

  it('accepts oauth2 session body and forwards trimmed values', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .post('/auth/oauth2/session')
      .send({
        accessToken: '  token-abc  ',
        scope: '  openid profile  ',
      })
      .expect(201);

    expect(oauth2ServiceMock.createSessionFromAccessToken).toHaveBeenCalledWith(
      'token-abc',
      'openid profile',
    );
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
});
