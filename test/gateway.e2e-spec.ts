import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  All,
  Controller,
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeysService } from '../src/modules/auth/api-keys.service';
import { GatewayProxyMiddleware } from '../src/modules/gateway/gateway-proxy.middleware';
import { RouteRegistryService } from '../src/modules/gateway/route-registry.service';

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
      };
    }

    if (key === 'gateway.oauth2Issuer') {
      return '';
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

@Controller('gateway/:namespace/:version')
class TestGatewayController {
  @All('*path')
  passthrough(): void {
    return;
  }
}

@Module({
  controllers: [TestGatewayController],
  providers: [
    GatewayProxyMiddleware,
    RouteRegistryService,
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
      .get('/gateway/hashguard/v1/health?deep=true')
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
      .get('/gateway/billing/v1/health')
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

    await request(server).get('/gateway/hashguard/v1/health').expect(401);

    expect(apiKeysServiceMock.authenticateApiKey).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
