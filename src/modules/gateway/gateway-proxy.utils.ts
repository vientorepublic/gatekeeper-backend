import type { Request } from 'express';
import type { PublicPathRule } from '../../common/types/gateway.types';

export interface RouteKey {
  namespace: string;
  version: string;
}

export function isResolvedRoute(value: unknown): value is {
  target: string;
  keepVersionPrefix: boolean;
  isPublic: boolean;
  publicPaths: PublicPathRule[];
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    target?: unknown;
    keepVersionPrefix?: unknown;
    isPublic?: unknown;
    publicPaths?: unknown;
  };

  return (
    typeof candidate.target === 'string' &&
    typeof candidate.keepVersionPrefix === 'boolean' &&
    typeof candidate.isPublic === 'boolean' &&
    Array.isArray(candidate.publicPaths)
  );
}

/**
 * Returns true when the given tail path and HTTP method match any of the public path rules.
 *
 * Path patterns:
 *  - `/health`   – exact match (trailing slash ignored)
 *  - `/docs/*`   – prefix match: matches `/docs/` and anything beneath it
 */
export function matchesPublicPath(
  rules: PublicPathRule[],
  tailPath: string,
  method: string,
): boolean {
  const rawPath = (tailPath.split('?')[0] ?? '/') || '/';
  // Normalize to always start with '/' — parseProxyPath strips the leading slash
  // when splitting URL segments, but rule paths are written with a leading slash.
  const pathWithoutQuery = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const upperMethod = method.toUpperCase();

  return rules.some((rule) => {
    if (
      rule.methods &&
      rule.methods.length > 0 &&
      !rule.methods.map((m) => m.toUpperCase()).includes(upperMethod)
    ) {
      return false;
    }

    if (rule.path.endsWith('/*')) {
      const prefix = rule.path.slice(0, -2);
      return (
        pathWithoutQuery === prefix || pathWithoutQuery.startsWith(prefix + '/')
      );
    }

    const normalizedRule = rule.path.replace(/\/$/, '');
    const normalizedPath = pathWithoutQuery.replace(/\/$/, '');
    return normalizedPath === normalizedRule;
  });
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
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  ) {
    return 'UPSTREAM_TIMEOUT';
  }

  if (typeof error !== 'object' || error === null) {
    return 'UPSTREAM_UNAVAILABLE';
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string'
    ? candidate.code
    : 'UPSTREAM_UNAVAILABLE';
}
