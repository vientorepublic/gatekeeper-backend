import 'reflect-metadata';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  All,
  Controller,
  Injectable,
  Module,
  NestMiddleware,
  NotFoundException,
  UnauthorizedException,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import autocannonModule from 'autocannon';
import { ApiKeysService } from '../../src/modules/auth/api-keys.service';
import { GatewayProxyMiddleware } from '../../src/modules/gateway/gateway-proxy.middleware';
import { RouteRegistryService } from '../../src/modules/gateway/route-registry.service';
import {
  buildUpstreamHeaders,
  isResolvedRoute,
} from '../../src/modules/gateway/gateway-proxy.utils';
import { GatewayMetricsService } from '../../src/modules/health/gateway-metrics.service';

interface AutocannonResult {
  requests: { average: number };
  latency: { p99: number };
  errors: number;
  timeouts: number;
}

type AutocannonCallback = (
  error: Error | null,
  result: AutocannonResult,
) => void;

type AutocannonInstance = {
  on: (event: 'error', listener: (error: Error) => void) => void;
};

type AutocannonOptions = {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  duration: number;
  connections: number;
  headers: Record<string, string>;
};

type AutocannonFn = (
  options: AutocannonOptions,
  callback: AutocannonCallback,
) => AutocannonInstance;

const autocannon = autocannonModule as unknown as AutocannonFn;

interface BenchScenario {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
}

interface BenchRunResult {
  mode: 'optimized' | 'legacy';
  scenario: string;
  requestsPerSec: number;
  p99LatencyMs: number;
  errors: number;
  timeouts: number;
  rssDeltaBytes: number;
}

type RequestLike = IncomingMessage & {
  originalUrl?: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
};

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isBodyAllowed(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== 'GET' && upper !== 'HEAD';
}

async function readRequestBodyLegacy(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  if (!isBodyAllowed(req.method ?? 'GET')) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

@Injectable()
class LegacyGatewayProxyMiddleware implements NestMiddleware {
  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async use(
    req: RequestLike,
    res: ServerResponse,
    _next: (error?: unknown) => void,
  ): Promise<void> {
    void _next;

    const proxyPath = this.parseProxyPath(req.originalUrl || req.url);
    if (!proxyPath) {
      throw new NotFoundException(
        'Path must follow /api/{namespace}/{version}/...',
      );
    }

    await this.assertGatewayAuthorization(req, proxyPath.namespace);

    const resolvedRoute = await this.routeRegistry.getTarget(
      proxyPath.namespace,
      proxyPath.version,
    );

    if (!isResolvedRoute(resolvedRoute)) {
      throw new NotFoundException(
        `No upstream route found for namespace "${proxyPath.namespace}" and version "${proxyPath.version}".`,
      );
    }

    const rewrittenPath = this.buildUpstreamPath(
      req.originalUrl || req.url,
      proxyPath.version,
      proxyPath.tailPath,
      resolvedRoute.keepVersionPrefix,
    );
    const upstreamUrl = new URL(rewrittenPath, resolvedRoute.target).toString();
    const body = await readRequestBodyLegacy(req);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(
        req as never,
        this.configService.get<string>('gateway.oauth2Issuer') || undefined,
      ),
      body: body ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    });

    res.statusCode = upstreamResponse.status;
    upstreamResponse.headers.forEach((value, key) => {
      const normalized = key.toLowerCase();
      if (normalized === 'transfer-encoding' || normalized === 'connection') {
        return;
      }

      res.setHeader(key, value);
    });

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    res.end(payload);
  }

  private parseProxyPath(
    path: string,
  ): { namespace: string; version: string; tailPath: string } | undefined {
    const queryIndex = path.indexOf('?');
    const pathname = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
    if (!pathname.startsWith('/api/')) {
      return undefined;
    }

    const segments = pathname.slice('/api/'.length).split('/');
    const namespace = segments[0];
    const version = segments[1];

    if (!namespace || !version) {
      return undefined;
    }

    return {
      namespace,
      version,
      tailPath: segments.length > 2 ? segments.slice(2).join('/') : '',
    };
  }

  private buildUpstreamPath(
    fullPath: string,
    version: string,
    tailPath: string,
    keepVersionPrefix: boolean,
  ): string {
    const tail = tailPath.length > 0 ? `/${tailPath}` : '';
    const basePath = keepVersionPrefix ? `/${version}${tail}` : tail || '/';
    const queryIndex = fullPath.indexOf('?');
    const queryString = queryIndex >= 0 ? fullPath.slice(queryIndex) : '';
    return `${basePath}${queryString}`;
  }

  private async assertGatewayAuthorization(
    req: RequestLike,
    namespace: string,
  ): Promise<void> {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const rawApiKey = authHeader.replace('Bearer ', '').trim();
    if (!rawApiKey) {
      throw new UnauthorizedException('Bearer token is empty');
    }

    await this.apiKeysService.authenticateApiKey(rawApiKey, namespace);
  }
}

@Controller('api/:namespace/:version')
class BenchGatewayController {
  @All('*path')
  passthrough(): void {
    return;
  }
}

function createConfigService(upstreamBaseUrl: string): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'gateway.routeMap') {
        return {
          bench: {
            v1: upstreamBaseUrl,
          },
        };
      }

      if (key === 'gateway.oauth2Issuer') {
        return '';
      }

      if (key === 'gateway.maxProxyRequestBodyBytes') {
        return 4 * 1024 * 1024;
      }

      if (key === 'gateway.proxyTimeoutMs') {
        return 10_000;
      }

      if (key === 'gateway.proxyCircuitBreakerFailureThreshold') {
        return 100;
      }

      if (key === 'gateway.proxyCircuitBreakerCooldownMs') {
        return 10_000;
      }

      return undefined;
    },
  } as unknown as ConfigService;
}

function createCacheManagerMock() {
  const cache = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve(cache.get(key) as T | undefined),
    set: (key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    },
  };
}

function createApiKeysServiceMock(): Pick<
  ApiKeysService,
  'authenticateApiKey'
> {
  return {
    authenticateApiKey: () =>
      Promise.resolve({
        id: 'bench-user',
        provider: 'benchmark',
        subject: 'benchmark-subject',
        email: null,
      } as never),
  };
}

async function createBenchmarkApp(
  mode: 'optimized' | 'legacy',
  upstreamBaseUrl: string,
): Promise<INestApplication> {
  const configService = createConfigService(upstreamBaseUrl);
  const cacheManager = createCacheManagerMock();
  const apiKeysService = createApiKeysServiceMock();

  const middlewareProvider =
    mode === 'optimized'
      ? GatewayProxyMiddleware
      : LegacyGatewayProxyMiddleware;

  const providers: Provider[] = [
    RouteRegistryService,
    middlewareProvider,
    {
      provide: ConfigService,
      useValue: configService,
    },
    {
      provide: CACHE_MANAGER,
      useValue: cacheManager,
    },
    {
      provide: ApiKeysService,
      useValue: apiKeysService,
    },
  ];

  if (mode === 'optimized') {
    providers.push(GatewayMetricsService);
  }

  @Module({
    controllers: [BenchGatewayController],
    providers,
  })
  class BenchmarkModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(middlewareProvider).forRoutes(BenchGatewayController);
    }
  }

  const moduleRef = await Test.createTestingModule({
    imports: [BenchmarkModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return app;
}

async function createUpstreamServer(): Promise<Server> {
  const payloadCache = new Map<number, Buffer>();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk));
          } else if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
          } else if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
          }
        }

        const body = Buffer.concat(chunks);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        res.end(body);
        return;
      }

      const size = Number(url.searchParams.get('size') || '65536');
      const normalizedSize = Number.isFinite(size) && size > 0 ? size : 65536;
      let payload = payloadCache.get(normalizedSize);
      if (!payload) {
        payload = Buffer.alloc(normalizedSize, 'a');
        payloadCache.set(normalizedSize, payload);
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/octet-stream');
      res.end(payload);
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  return server;
}

function runAutocannon(options: AutocannonOptions): Promise<AutocannonResult> {
  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    instance.on('error', (error: Error) => {
      reject(error);
    });
  });
}

async function runScenario(
  app: INestApplication,
  mode: 'optimized' | 'legacy',
  scenario: BenchScenario,
): Promise<BenchRunResult> {
  const server = app.getHttpServer() as { address: () => AddressInfo };
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}${scenario.path}`;
  const duration = getEnvNumber('BENCH_DURATION_SECONDS', 10);
  const connections = getEnvNumber('BENCH_CONNECTIONS', 60);

  if (typeof global.gc === 'function') {
    global.gc();
  }

  const rssBefore = process.memoryUsage().rss;

  const headers: Record<string, string> = {
    authorization: 'Bearer bench_api_key',
  };

  if (scenario.method === 'POST') {
    headers['content-type'] = 'application/octet-stream';
  }

  const result = await runAutocannon({
    url,
    method: scenario.method,
    body: scenario.body,
    duration,
    connections,
    headers,
  });

  const rssAfter = process.memoryUsage().rss;

  return {
    mode,
    scenario: scenario.name,
    requestsPerSec: result.requests.average,
    p99LatencyMs: result.latency.p99,
    errors: result.errors,
    timeouts: result.timeouts,
    rssDeltaBytes: rssAfter - rssBefore,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

async function main(): Promise<void> {
  const payloadBytes = getEnvNumber('BENCH_PAYLOAD_BYTES', 262_144);

  const upstream = await createUpstreamServer();
  const upstreamAddress = upstream.address() as AddressInfo;
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}`;

  const optimizedApp = await createBenchmarkApp('optimized', upstreamBaseUrl);
  const legacyApp = await createBenchmarkApp('legacy', upstreamBaseUrl);

  const scenarios: BenchScenario[] = [
    {
      name: `GET-${Math.round(payloadBytes / 1024)}KB`,
      method: 'GET',
      path: `/api/bench/v1/payload?size=${payloadBytes}`,
    },
    {
      name: `POST-${Math.round(payloadBytes / 1024)}KB`,
      method: 'POST',
      path: '/api/bench/v1/echo',
      body: 'x'.repeat(payloadBytes),
    },
  ];

  try {
    const allResults: BenchRunResult[] = [];

    for (const scenario of scenarios) {
      const legacy = await runScenario(legacyApp, 'legacy', scenario);
      const optimized = await runScenario(optimizedApp, 'optimized', scenario);
      allResults.push(legacy, optimized);

      const throughputGain =
        ((optimized.requestsPerSec - legacy.requestsPerSec) /
          Math.max(legacy.requestsPerSec, 0.0001)) *
        100;
      const latencyReduction =
        ((legacy.p99LatencyMs - optimized.p99LatencyMs) /
          Math.max(legacy.p99LatencyMs, 0.0001)) *
        100;

      console.log('');
      console.log(`[${scenario.name}]`);
      console.table([
        {
          mode: legacy.mode,
          rps: legacy.requestsPerSec.toFixed(2),
          p99Ms: legacy.p99LatencyMs.toFixed(2),
          errors: legacy.errors,
          timeouts: legacy.timeouts,
          rssDeltaMB: (legacy.rssDeltaBytes / (1024 * 1024)).toFixed(2),
        },
        {
          mode: optimized.mode,
          rps: optimized.requestsPerSec.toFixed(2),
          p99Ms: optimized.p99LatencyMs.toFixed(2),
          errors: optimized.errors,
          timeouts: optimized.timeouts,
          rssDeltaMB: (optimized.rssDeltaBytes / (1024 * 1024)).toFixed(2),
        },
      ]);
      console.log(`throughput gain: ${formatPercent(throughputGain)}`);
      console.log(`p99 latency reduction: ${formatPercent(latencyReduction)}`);
    }

    if (process.env.BENCH_ASSERT === '1') {
      const minGain = getEnvNumber('BENCH_MIN_THROUGHPUT_GAIN_PERCENT', 5);
      const failed = allResults
        .filter((item) => item.mode === 'optimized')
        .some((optimized) => {
          const legacy = allResults.find(
            (candidate) =>
              candidate.mode === 'legacy' &&
              candidate.scenario === optimized.scenario,
          );

          if (!legacy) {
            return true;
          }

          const gain =
            ((optimized.requestsPerSec - legacy.requestsPerSec) /
              Math.max(legacy.requestsPerSec, 0.0001)) *
            100;

          return gain < minGain;
        });

      if (failed) {
        throw new Error(
          `Benchmark assertion failed. Optimized throughput gain is below ${minGain}%.`,
        );
      }
    }
  } finally {
    await Promise.allSettled([optimizedApp.close(), legacyApp.close()]);
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve());
    });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
