import {
  HttpException,
  Injectable,
  NestMiddleware,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { Transform, Writable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { ApiKeysService } from '../auth/api-keys.service';
import { RouteRegistryService } from './route-registry.service';
import { GatewayMetricsService } from '../health/gateway-metrics.service';
import {
  buildUpstreamHeaders,
  getProxyErrorCode,
  isResolvedRoute,
} from './gateway-proxy.utils';

interface ResolvedRequestRoute {
  namespace: string;
  version: string;
}

interface ProxyPathParts extends ResolvedRequestRoute {
  tailPath: string;
}

@Injectable()
export class GatewayProxyMiddleware implements NestMiddleware {
  private readonly maxRequestBodyBytes: number;
  private readonly oauth2IssuerHint?: string;
  private readonly proxyTimeoutMs: number;
  private readonly circuitBreakerFailureThreshold: number;
  private readonly circuitBreakerCooldownMs: number;
  private readonly circuitState = new Map<
    string,
    { consecutiveFailures: number; openUntil: number }
  >();

  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
    private readonly gatewayMetricsService: GatewayMetricsService,
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
  }

  async use(req: Request, res: Response, _next: NextFunction): Promise<void> {
    void _next;
    const startedAt = Date.now();
    this.gatewayMetricsService.recordRequestStarted();

    try {
      const proxyPath = this.parseProxyPath(req);
      if (!proxyPath) {
        throw new NotFoundException(
          'Path must follow /api/{namespace}/{version}/...',
        );
      }

      const { namespace, version } = proxyPath;

      await this.assertGatewayAuthorization(req, namespace);

      const resolvedRoute = await this.routeRegistry.getTarget(
        namespace,
        version,
      );
      if (!isResolvedRoute(resolvedRoute)) {
        throw new NotFoundException(
          `No upstream route found for namespace "${namespace}" and version "${version}".`,
        );
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
      if (error instanceof HttpException) {
        this.gatewayMetricsService.recordGatewayHttpStatus(error.getStatus());
        throw error;
      }

      this.gatewayMetricsService.recordGatewayHttpStatus(502);
      this.writeUpstreamProblem(error, req.originalUrl || req.url, res);
    } finally {
      this.gatewayMetricsService.recordRequestFinished(Date.now() - startedAt);
    }
  }

  private getPositiveNumberConfig(path: string, fallback: number): number {
    const configuredValue = this.configService.get<unknown>(path, {
      infer: true,
    });

    return typeof configuredValue === 'number' && configuredValue > 0
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

  private assertCircuitClosed(target: string): void {
    const state = this.circuitState.get(target);
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
      this.circuitState.delete(target);
    }
  }

  private markUpstreamFailure(target: string): void {
    const now = Date.now();
    const previous = this.circuitState.get(target);
    const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;

    if (consecutiveFailures >= this.circuitBreakerFailureThreshold) {
      this.circuitState.set(target, {
        consecutiveFailures,
        openUntil: now + this.circuitBreakerCooldownMs,
      });
      return;
    }

    this.circuitState.set(target, {
      consecutiveFailures,
      openUntil: 0,
    });
  }

  private markUpstreamSuccess(target: string): void {
    this.circuitState.delete(target);
  }

  private async forwardToUpstream(
    req: Request,
    res: Response,
    target: string,
    version: string,
    tailPath: string,
    keepVersionPrefix: boolean,
  ): Promise<void> {
    this.assertCircuitClosed(target);

    const rewrittenPath = this.buildUpstreamPath(
      req,
      version,
      tailPath,
      keepVersionPrefix,
    );
    const upstreamUrl = new URL(rewrittenPath, target).toString();
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, this.proxyTimeoutMs);

    const shouldForwardBody = this.isRequestBodyAllowed(req.method);
    const requestBody = shouldForwardBody
      ? req.pipe(this.createLimitedRequestBodyStream(req))
      : undefined;

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

    try {
      const requestInit: RequestInit & { duplex?: 'half' } = {
        method: req.method,
        headers: buildUpstreamHeaders(req, this.oauth2IssuerHint),
        body: requestBody as unknown as BodyInit,
        redirect: 'manual',
        signal: timeoutController.signal,
        duplex: shouldForwardBody ? 'half' : undefined,
      };

      const upstreamResponse = await fetch(upstreamUrl, requestInit);
      this.gatewayMetricsService.recordUpstreamStatus(upstreamResponse.status);

      res.status(upstreamResponse.status);
      upstreamResponse.headers.forEach((value, key) => {
        const normalizedKey = key.toLowerCase();
        if (
          normalizedKey === 'transfer-encoding' ||
          normalizedKey === 'connection'
        ) {
          return;
        }

        res.setHeader(key, value);
      });

      if (!upstreamResponse.body) {
        this.markUpstreamSuccess(target);
        res.end();
        return;
      }

      await upstreamResponse.body.pipeTo(Writable.toWeb(res));

      this.markUpstreamSuccess(target);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        this.gatewayMetricsService.recordPayloadTooLarge();
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name?: unknown }).name === 'AbortError'
      ) {
        this.gatewayMetricsService.recordTimeout();
      }

      if (!(error instanceof HttpException)) {
        this.markUpstreamFailure(target);
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
    const instance = requestUrl && requestUrl.length > 0 ? requestUrl : '/';
    const title = STATUS_CODES[502] ?? 'Bad Gateway';
    const body = JSON.stringify({
      title,
      status: 502,
      detail: 'Failed to receive response from upstream service.',
      instance,
      errorCode,
    });

    response.status(502);
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(body);
  }

  private parseProxyPath(req: Request): ProxyPathParts | undefined {
    const originalUrl = req.originalUrl || req.url;
    const queryIndex = originalUrl.indexOf('?');
    const pathname =
      queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl;
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
    const tail = tailPath.length > 0 ? `/${tailPath}` : '';

    const basePath = keepVersionPrefix ? `/${version}${tail}` : tail || '/';

    const originalUrl = req.originalUrl || req.url;
    const queryIndex = originalUrl.indexOf('?');
    const queryString = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';

    return `${basePath}${queryString}`;
  }
}
