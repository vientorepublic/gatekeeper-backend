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

interface ProxyErrorShape {
  code?: string;
}

interface RouteKey {
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

    try {
      await this.forwardToUpstream(req, res, target, namespace, version);
    } catch (error) {
      this.writeUpstreamProblem(error, req.originalUrl || req.url, res);
    }
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

  private getOAuth2IssuerHint(): string | undefined {
    const issuer = this.configService.get<string>('gateway.oauth2Issuer', {
      infer: true,
    });

    return issuer || undefined;
  }

  private async readRequestBody(req: Request): Promise<Buffer | undefined> {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
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

  private buildUpstreamHeaders(req: Request): Headers {
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'undefined') {
        continue;
      }

      if (Array.isArray(value)) {
        headers.set(name, value.join(','));
      } else {
        headers.set(name, value);
      }
    }

    headers.delete('host');
    headers.delete('content-length');

    const issuerHint = this.getOAuth2IssuerHint();
    if (issuerHint) {
      headers.set('x-oauth2-issuer-hint', issuerHint);
    }

    return headers;
  }

  private async forwardToUpstream(
    req: Request,
    res: Response,
    target: string,
    namespace: string,
    version: string,
  ): Promise<void> {
    const rewrittenPath = this.rewritePath(
      req.originalUrl || req.url,
      namespace,
      version,
    );
    const upstreamUrl = new URL(rewrittenPath, target).toString();
    const body = await this.readRequestBody(req);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: this.buildUpstreamHeaders(req),
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

    response.status(502);
    response.setHeader(
      'content-type',
      'application/problem+json; charset=utf-8',
    );
    response.end(body);
  }
}
