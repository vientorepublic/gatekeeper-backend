import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RouteRegistryService } from './route-registry.service';
import {
  buildUpstreamHeaders,
  getProxyErrorCode,
  isResolvedRoute,
  readRequestBody,
} from './gateway-proxy.utils';

interface ResolvedRequestRoute {
  namespace: string;
  version: string;
}

@Injectable()
export class GatewayProxyMiddleware implements NestMiddleware {
  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction): Promise<void> {
    void _next;

    const routeKey = this.resolveRoute(req);
    if (!routeKey) {
      throw new NotFoundException(
        'Path must follow /gateway/{namespace}/{version}/...',
      );
    }

    const { namespace, version } = routeKey;

    const resolvedRoute = await this.routeRegistry.getTarget(
      namespace,
      version,
    );
    if (!isResolvedRoute(resolvedRoute)) {
      throw new NotFoundException(
        `No upstream route found for namespace "${namespace}" and version "${version}".`,
      );
    }

    try {
      await this.forwardToUpstream(
        req,
        res,
        resolvedRoute.target,
        version,
        resolvedRoute.keepVersionPrefix,
      );
    } catch (error) {
      this.writeUpstreamProblem(error, req.originalUrl || req.url, res);
    }
  }

  private getOAuth2IssuerHint(): string | undefined {
    const issuer = this.configService.get<string>('gateway.oauth2Issuer', {
      infer: true,
    });

    return issuer || undefined;
  }

  private async forwardToUpstream(
    req: Request,
    res: Response,
    target: string,
    version: string,
    keepVersionPrefix: boolean,
  ): Promise<void> {
    const rewrittenPath = this.buildUpstreamPath(
      req,
      version,
      keepVersionPrefix,
    );
    const upstreamUrl = new URL(rewrittenPath, target).toString();
    const body = await readRequestBody(req);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req, this.getOAuth2IssuerHint()),
      body: body ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    });

    res.status(upstreamResponse.status);
    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'transfer-encoding') {
        return;
      }

      res.setHeader(key, value);
    });

    if (!upstreamResponse.body) {
      res.end();
      return;
    }

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    res.send(payload);
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
    response.setHeader(
      'content-type',
      'application/problem+json; charset=utf-8',
    );
    response.end(body);
  }

  private resolveRoute(req: Request): ResolvedRequestRoute | undefined {
    const namespace = req.params.namespace;
    const version = req.params.version;

    if (typeof namespace !== 'string' || typeof version !== 'string') {
      return undefined;
    }

    if (namespace.length === 0 || version.length === 0) {
      return undefined;
    }

    return {
      namespace,
      version,
    };
  }

  private buildUpstreamPath(
    req: Request,
    version: string,
    keepVersionPrefix: boolean,
  ): string {
    const tailParam = req.params.path;
    const tail =
      typeof tailParam === 'string' && tailParam.length > 0
        ? `/${tailParam}`
        : '';

    const basePath = keepVersionPrefix ? `/${version}${tail}` : tail || '/';

    const originalUrl = req.originalUrl || req.url;
    const queryIndex = originalUrl.indexOf('?');
    const queryString = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';

    return `${basePath}${queryString}`;
  }
}
