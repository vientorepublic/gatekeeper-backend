import {
  Injectable,
  NestMiddleware,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RouteRegistryService } from './route-registry.service';
import {
  buildUpstreamHeaders,
  extractRouteKey,
  getProxyErrorCode,
  isResolvedRoute,
  readRequestBody,
  rewritePath,
} from './gateway-proxy.utils';

@Injectable()
export class GatewayProxyMiddleware implements NestMiddleware {
  constructor(
    private readonly routeRegistry: RouteRegistryService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, _next: NextFunction): Promise<void> {
    void _next;

    const routeKey = extractRouteKey(req.path);
    if (!routeKey) {
      throw new NotFoundException(
        'Path must follow /{namespace}/{version}/...',
      );
    }

    const { namespace, version } = routeKey;

    if (!req.headers.authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

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
        namespace,
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
    namespace: string,
    version: string,
    keepVersionPrefix: boolean,
  ): Promise<void> {
    const rewrittenPath = rewritePath(
      req.originalUrl || req.url,
      namespace,
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
}
