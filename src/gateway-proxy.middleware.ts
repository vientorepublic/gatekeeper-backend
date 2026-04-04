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
    const parts = req.path.split('/').filter(Boolean);
    const [namespace, version] = parts;

    if (!namespace || !version) {
      throw new NotFoundException(
        'Path must follow /{namespace}/{version}/...',
      );
    }

    if (!req.headers.authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const target = await this.routeRegistry.getTarget(namespace, version);
    if (!target) {
      throw new NotFoundException(
        `No upstream route configured for ${namespace}/${version}`,
      );
    }

    const proxy = createProxyMiddleware<Request, Response>({
      target,
      changeOrigin: true,
      pathRewrite: (path) => {
        const prefix = `/${namespace}/${version}`;
        const rewritten = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path;
        return rewritten || '/';
      },
      on: {
        proxyReq: (proxyReq) => {
          const issuer = this.configService.get<string>(
            'gateway.oauth2Issuer',
            {
              infer: true,
            },
          );
          if (issuer) {
            proxyReq.setHeader('x-oauth2-issuer-hint', issuer);
          }
        },
        error: (error, request, response) => {
          if (!isServerResponseLike(response)) {
            return;
          }

          if (response.headersSent) {
            response.end();
            return;
          }

          const proxyError = error as ProxyErrorShape;
          const errorCode = proxyError.code ?? 'UPSTREAM_UNAVAILABLE';
          const instance =
            typeof request.url === 'string' && request.url ? request.url : '/';
          const title = STATUS_CODES[502] ?? 'Bad Gateway';
          const body = JSON.stringify({
            type: 'urn:problem:gateway:upstream-unavailable',
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
        },
      },
    });

    void proxy(req, res, next);
  }
}
