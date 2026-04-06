import type { Request } from 'express';

export interface RouteKey {
  namespace: string;
  version: string;
}

export function isResolvedRoute(
  value: unknown,
): value is { target: string; keepVersionPrefix: boolean } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    target?: unknown;
    keepVersionPrefix?: unknown;
  };

  return (
    typeof candidate.target === 'string' &&
    typeof candidate.keepVersionPrefix === 'boolean'
  );
}

export function extractRouteKey(path: string): RouteKey | undefined {
  const parts = path.split('/').filter(Boolean);
  const [namespace, version] = parts;

  if (!namespace || !version) {
    return undefined;
  }

  return { namespace, version };
}

export function rewritePath(
  path: string,
  namespace: string,
  version: string,
  keepVersionPrefix: boolean,
): string {
  const prefix = keepVersionPrefix
    ? `/${namespace}`
    : `/${namespace}/${version}`;
  const rewritten = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return rewritten || '/';
}

export async function readRequestBody(
  req: Request,
): Promise<Buffer | undefined> {
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

export function buildUpstreamHeaders(
  req: Request,
  issuerHint?: string,
): Headers {
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
  headers.delete('authorization');
  headers.delete('x-api-key');

  if (issuerHint) {
    headers.set('x-oauth2-issuer-hint', issuerHint);
  }

  return headers;
}

export function getProxyErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'UPSTREAM_UNAVAILABLE';
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string'
    ? candidate.code
    : 'UPSTREAM_UNAVAILABLE';
}
