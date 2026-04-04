import {
  Injectable,
  NestMiddleware,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { NextFunction, Request, Response } from 'express';
import { RouteRegistryService } from './route-registry.service';

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
      },
    });

    void proxy(req, res, next);
  }
}
