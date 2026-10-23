import {
  HttpException,
  BadRequestException,
  HttpStatus,
  Injectable,
  NestMiddleware,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { Readable, Transform, Writable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { ApiKeysService } from '../auth/api-keys.service';
import { ProxyStateService } from './proxy-state.service';
import { RouteRegistryService } from './route-registry.service';
import { GatewayMetricsService } from '../health/gateway-metrics.service';
import {
  buildUpstreamHeaders,
  getProxyErrorCode,
  isResolvedRoute,
  isSafeProxyPath,
  matchesPublicPath,
} from './gateway-proxy.utils';

interface ResolvedRequestRoute {
  namespace: string;
  version: string;
}

interface ProxyPathParts extends ResolvedRequestRoute {
  tailPath: string;
}

// Response headers from upstream that must never be forwarded to clients.
// Using a blocklist instead of an allowlist to prevent:
//   - Upstream overriding gateway CORS policy (access-control-*)
//   - Session-fixation via upstream Set-Cookie
//   - Technology fingerprinting via Server / X-Powered-By
//   - Hop-by-hop header leakage
const BLOCKED_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'set-cookie',
  'server',
  'x-powered-by',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
]);

@Injectable()
export class GatewayProxyMiddleware implements NestMiddleware {
  private readonly maxRequestBodyBytes: number;
  private readonly oauth2IssuerHint?: string;
  private readonly proxyTimeoutMs: number;
  private readonly circuitBreakerFailureThreshold: number;
  private readonly circuitBreakerCooldownMs: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitMaxRequests: number;
  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
    private readonly gatewayMetricsService: GatewayMetricsService,
    private readonly proxyStateService: ProxyStateService,
  ) {
    this.maxRequestBodyBytes = this.getPositiveNumberConfig(
      'gateway.maxProxyRequestBodyBytes',
      1_048_576,
    );
    this.oauth2IssuerHint = this.getOptionalStringConfig(
      'gateway.oauth2Issuer',
    );
    this.proxyTimeoutMs = this.getPositiveNumberConfig(
      'gateway.proxyTimeoutMs',
      15_000,
    );
    this.circuitBreakerFailureThreshold = this.getPositiveNumberConfig(
      'gateway.proxyCircuitBreakerFailureThreshold',
      3,
    );
    this.circuitBreakerCooldownMs = this.getPositiveNumberConfig(
      'gateway.proxyCircuitBreakerCooldownMs',
      10_000,
    );
    this.rateLimitWindowMs = this.getPositiveNumberConfig(
      'gateway.rateLimitWindowMs',
      60_000,
    );
    this.rateLimitMaxRequests = this.getPositiveNumberConfig(
      'gateway.rateLimitMaxRequests',
      100,
    );
  }

  async use(req: Request, res: Response, _next: NextFunction): Promise<void> {
    void _next;
    const startedAt = Date.now();
    this.gatewayMetricsService.recordRequestStarted();

    try {
      const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      await this.assertRateLimit(clientIp);

      const proxyPath = this.parseProxyPath(req);
      if (!proxyPath) {
        throw new NotFoundException(
          'Path must follow /api/{namespace}/{version}/...',
        );
      }

      const { namespace, version } = proxyPath;

      const resolvedRoute = await this.routeRegistry.getTarget(
        namespace,
        version,
      );
      if (!isResolvedRoute(resolvedRoute)) {
        throw new NotFoundException(
          `No upstream route found for namespace "${namespace}" and version "${version}".`,
        );
      }

      if (
        !resolvedRoute.isPublic &&
        !matchesPublicPath(
          resolvedRoute.publicPaths,
          proxyPath.tailPath,
          req.method,
        )
      ) {
        await this.assertGatewayAuthorization(req, namespace);
      }

      await this.forwardToUpstream(
        req,
        res,
        resolvedRoute.target,
        version,
        proxyPath.tailPath,
        resolvedRoute.keepVersionPrefix,
      );
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        this.gatewayMetricsService.recordPayloadTooLarge();
      }
      if (error instanceof HttpException) {
        this.gatewayMetricsService.recordGatewayHttpStatus(error.getStatus());
        throw error;
      }

      this.gatewayMetricsService.recordGatewayHttpStatus(500);
      this.writeUpstreamProblem(error, req.originalUrl || req.url, res);
    } finally {
      this.gatewayMetricsService.recordRequestFinished(Date.now() - startedAt);
    }
  }

  private getPositiveNumberConfig(path: string, fallback: number): number {
    const configuredValue = this.configService.get<unknown>(path, {
      infer: true,
    });

    return typeof configuredValue === 'number' &&
      Number.isFinite(configuredValue) &&
      configuredValue > 0
      ? configuredValue
      : fallback;
  }

  private async assertGatewayAuthorization(
    req: Request,
    namespace: string,
  ): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing bearer token. Use Bearer API key for use REST API requests.',
      );
    }

    const rawApiKey = authHeader.replace('Bearer ', '').trim();
    if (rawApiKey.length === 0) {
      throw new UnauthorizedException('Bearer token is empty');
    }

    await this.apiKeysService.authenticateApiKey(rawApiKey, namespace);
  }

  private getOptionalStringConfig(path: string): string | undefined {
    const value = this.configService.get<string>(path, {
      infer: true,
    });

    return value || undefined;
  }

  private isRequestBodyAllowed(method: string): boolean {
    const normalized = method.toUpperCase();
    return normalized !== 'GET' && normalized !== 'HEAD';
  }

  private createLimitedRequestBodyStream(req: Request): Transform {
    let totalLength = 0;

    return new Transform({
      transform: (chunk, _encoding, callback) => {
        const normalizedChunk = Buffer.isBuffer(chunk)
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : Buffer.from(String(chunk));

        totalLength += normalizedChunk.length;
        if (
          this.maxRequestBodyBytes > 0 &&
          totalLength > this.maxRequestBodyBytes
        ) {
          callback(
            new PayloadTooLargeException(
              `Request body exceeds maximum size of ${this.maxRequestBodyBytes} bytes`,
            ),
          );
          return;
        }

        callback(null, normalizedChunk);
      },
    }).on('error', (error) => {
      req.destroy(error);
    });
  }

  private async assertCircuitClosed(target: string): Promise<void> {
    const state = await this.proxyStateService.getCircuitState(target);
    if (!state) {
      return;
    }

    const now = Date.now();
    if (state.openUntil > now) {
      this.gatewayMetricsService.recordCircuitOpenRejection();
      throw new ServiceUnavailableException(
        'Upstream temporarily unavailable. Please retry shortly.',
      );
    }

    if (state.openUntil > 0) {
      await this.proxyStateService.deleteCircuitState(target);
    }
  }

  private async markUpstreamFailure(target: string): Promise<void> {
    const now = Date.now();
    const previous = await this.proxyStateService.getCircuitState(target);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;

    const newState =
      consecutiveFailures >= this.circuitBreakerFailureThreshold
        ? {
            consecutiveFailures,
            openUntil: now + this.circuitBreakerCooldownMs,
          }
        : { consecutiveFailures, openUntil: 0 };

    await this.proxyStateService.setCircuitState(
      target,
      newState,
      this.circuitBreakerCooldownMs,
    );
  }

  private async markUpstreamSuccess(target: string): Promise<void> {
    await this.proxyStateService.deleteCircuitState(target);
  }

  private async forwardToUpstream(
    req: Request,
    res: Response,
    target: string,
    version: string,
    tailPath: string,
    keepVersionPrefix: boolean,
  ): Promise<void> {
    await this.assertCircuitClosed(target);

    const rewrittenPath = this.buildUpstreamPath(
      req,
      version,
      tailPath,
      keepVersionPrefix,
    );
    const upstreamUrl = new URL(rewrittenPath, target);
    if (upstreamUrl.origin !== new URL(target).origin) {
      throw new BadRequestException('Invalid proxy path');
    }

    const shouldForwardBody = this.isRequestBodyAllowed(req.method);

    const contentLengthHeader = req.headers['content-length'];
    if (shouldForwardBody && typeof contentLengthHeader === 'string') {
      const declaredLength = Number(contentLengthHeader);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > this.maxRequestBodyBytes
      ) {
        throw new PayloadTooLargeException(
          `Request body exceeds maximum size of ${this.maxRequestBodyBytes} bytes`,
        );
      }
    }

    const rawBodyReq = req as Request & { rawBody?: Buffer };
    const rawBody = shouldForwardBody ? rawBodyReq.rawBody : undefined;
    if (rawBody !== undefined && rawBody.length > this.maxRequestBodyBytes) {
      throw new PayloadTooLargeException(
        `Request body exceeds maximum size of ${this.maxRequestBodyBytes} bytes`,
      );
    }
    // Node's stream/web and lib.dom differ in their BYOB types despite sharing the runtime stream API.
    const requestBody: BodyInit | undefined = shouldForwardBody
      ? rawBody !== undefined
        ? new Uint8Array(rawBody)
        : (Readable.toWeb(
            req.pipe(this.createLimitedRequestBodyStream(req)),
          ) as unknown as BodyInit)
      : undefined;
    const isStreamBody = shouldForwardBody && rawBody === undefined;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      this.proxyTimeoutMs,
    );

    try {
      const requestInit: RequestInit & { duplex?: 'half' } = {
        method: req.method,
        headers: buildUpstreamHeaders(req, this.oauth2IssuerHint),
        body: requestBody,
        redirect: 'manual',
        signal: timeoutController.signal,
        duplex: isStreamBody ? 'half' : undefined,
      };

      const upstreamResponse = await fetch(upstreamUrl.toString(), requestInit);
      this.gatewayMetricsService.recordUpstreamStatus(upstreamResponse.status);

      res.status(upstreamResponse.status);
      const connectionHeaders = new Set(
        (upstreamResponse.headers.get('connection') ?? '')
          .toLowerCase()
          .split(',')
          .map((name) => name.trim()),
      );
      const decompressed = /\b(gzip|deflate|br)\b/i.test(
        upstreamResponse.headers.get('content-encoding') ?? '',
      );
      upstreamResponse.headers.forEach((value, key) => {
        if (
          BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase()) ||
          connectionHeaders.has(key.toLowerCase()) ||
          key.toLowerCase() === 'content-length' ||
          (decompressed && key.toLowerCase() === 'content-encoding')
        ) {
          return;
        }
        res.setHeader(key, value);
      });

      if (!upstreamResponse.body) {
        await this.markUpstreamSuccess(target);
        res.end();
        return;
      }

      await upstreamResponse.body.pipeTo(Writable.toWeb(res));

      await this.markUpstreamSuccess(target);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name?: unknown }).name === 'AbortError'
      ) {
        this.gatewayMetricsService.recordTimeout();
      }

      if (!(error instanceof HttpException)) {
        await this.markUpstreamFailure(target);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private writeUpstreamProblem(
    error: unknown,
    requestUrl: string | undefined,
    response: Response,
  ): void {
    if (response.headersSent) {
      response.end();
      return;
    }

    const errorCode = getProxyErrorCode(error);
    // Strip query string from instance to avoid leaking sensitive query parameters
    const rawInstance = requestUrl && requestUrl.length > 0 ? requestUrl : '/';
    const instance = rawInstance.includes('?')
      ? rawInstance.slice(0, rawInstance.indexOf('?'))
      : rawInstance;
    const title = STATUS_CODES[500] ?? 'Internal Server Error';
    const body = JSON.stringify({
      title,
      status: 500,
      detail: 'Failed to receive response from upstream service.',
      instance,
      errorCode,
    });

    response.status(500);
    response.setHeader(
      'content-type',
      'application/problem+json; charset=utf-8',
    );
    response.end(body);
  }

  private async assertRateLimit(clientIp: string): Promise<void> {
    const count = await this.proxyStateService.incrementRateLimit(
      clientIp,
      this.rateLimitWindowMs,
    );
    if (count > this.rateLimitMaxRequests) {
      throw new HttpException(
        'Rate limit exceeded. Please retry later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private parseProxyPath(req: Request): ProxyPathParts | undefined {
    const originalUrl = req.originalUrl || req.url;
    const queryIndex = originalUrl.indexOf('?');
    const pathname =
      queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl;
    if (!isSafeProxyPath(pathname)) {
      throw new BadRequestException(
        'Proxy paths cannot contain traversal segments or backslashes',
      );
    }
    if (!pathname.startsWith('/api/')) {
      return undefined;
    }

    const segments = pathname.slice('/api/'.length).split('/');
    const namespace = segments[0];
    const version = segments[1];

    if (!namespace || !version) {
      return undefined;
    }

    const tailPath = segments.length > 2 ? segments.slice(2).join('/') : '';

    return {
      namespace,
      version,
      tailPath,
    };
  }

  private buildUpstreamPath(
    req: Request,
    version: string,
    tailPath: string,
    keepVersionPrefix: boolean,
  ): string {
    // Strip leading slashes to prevent protocol-relative URL injection:
    // "//evil.com/path" passed to new URL(relative, base) overrides the base host (SSRF).
    const normalizedTail = tailPath.replace(/^\/+/, '');
    const tail = normalizedTail.length > 0 ? `/${normalizedTail}` : '';

    const basePath = keepVersionPrefix ? `/${version}${tail}` : tail || '/';

    const originalUrl = req.originalUrl || req.url;
    const queryIndex = originalUrl.indexOf('?');
    const queryString = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';

    return `${basePath}${queryString}`;
  }
}
