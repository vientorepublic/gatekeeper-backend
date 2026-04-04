import {
  Injectable,
  NestMiddleware,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { NextFunction, Request, Response } from 'express';
import { RouteRegistryService } from './route-registry.service';

interface ProxyErrorShape {
  code?: string;
}

interface RouteKey {
  namespace: string;
  version: string;
}

function isServerResponseLike(value: unknown): value is ServerResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'setHeader' in value &&
    'end' in value &&
    'statusCode' in value
  );
}

@Injectable()
export class GatewayProxyMiddleware implements NestMiddleware {
  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { namespace, version } = this.extractRouteKey(req.path);

    if (!req.headers.authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const target = await this.routeRegistry.getTarget(namespace, version);
    if (!target) {
      throw new NotFoundException(
        `No upstream route found for namespace "${namespace}" and version "${version}".`,
      );
    }

    const proxy = this.createProxy(namespace, version, target);

    void proxy(req, res, next);
  }

  private extractRouteKey(path: string): RouteKey {
    const parts = path.split('/').filter(Boolean);
    const [namespace, version] = parts;

    if (!namespace || !version) {
      throw new NotFoundException(
        'Path must follow /{namespace}/{version}/...',
      );
    }

    return { namespace, version };
  }

  private createProxy(namespace: string, version: string, target: string) {
    return createProxyMiddleware<Request, Response>({
      target,
      changeOrigin: true,
      pathRewrite: (path) => this.rewritePath(path, namespace, version),
      on: {
        proxyReq: (proxyReq) => this.onProxyReq(proxyReq),
        error: (error, request, response) =>
          this.onProxyError(error, request.url, response),
      },
    });
  }

  private rewritePath(
    path: string,
    namespace: string,
    version: string,
  ): string {
    const prefix = `/${namespace}/${version}`;
    const rewritten = path.startsWith(prefix)
      ? path.slice(prefix.length)
      : path;
    return rewritten || '/';
  }

  private onProxyReq(proxyReq: {
    setHeader: (name: string, value: string) => void;
  }): void {
    const issuer = this.configService.get<string>('gateway.oauth2Issuer', {
      infer: true,
    });

    if (issuer) {
      proxyReq.setHeader('x-oauth2-issuer-hint', issuer);
    }
  }

  private onProxyError(
    error: unknown,
    requestUrl: string | undefined,
    response: unknown,
  ): void {
    if (!isServerResponseLike(response)) {
      return;
    }

    if (response.headersSent) {
      response.end();
      return;
    }

    const proxyError = error as ProxyErrorShape;
    const errorCode = proxyError.code ?? 'UPSTREAM_UNAVAILABLE';
    const instance = requestUrl && requestUrl.length > 0 ? requestUrl : '/';
    const title = STATUS_CODES[502] ?? 'Bad Gateway';
    const body = JSON.stringify({
      title,
      status: 502,
      detail: 'Failed to receive response from upstream service.',
      instance,
      errorCode,
    });

    response.statusCode = 502;
    response.setHeader(
      'content-type',
      'application/problem+json; charset=utf-8',
    );
    response.end(body);
  }
}
