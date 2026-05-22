import { registerAs } from '@nestjs/config';
import type { PublicPathRule, RouteMap } from '../common/types/gateway.types';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  charset: string;
  synchronize: boolean;
  migrationsRun: boolean;
  logging: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePublicPath(
  entry: unknown,
  namespace: string,
  index: number,
): PublicPathRule {
  if (typeof entry === 'string') {
    if (entry.length === 0) {
      throw new Error(
        `ROUTE_MAP publicPaths[${index}] for "${namespace}" must be a non-empty string`,
      );
    }
    return { path: entry };
  }

  if (isRecord(entry) && typeof entry['path'] === 'string') {
    const rule: PublicPathRule = { path: entry['path'] };
    if (Array.isArray(entry['methods'])) {
      rule.methods = (entry['methods'] as unknown[])
        .filter((m): m is string => typeof m === 'string')
        .map((m) => m.toUpperCase());
    }
    return rule;
  }

  throw new Error(
    `ROUTE_MAP publicPaths[${index}] for "${namespace}" must be a string or { path, methods? } object`,
  );
}

function validateTargetUrl(target: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`Invalid URL for "${context}": "${target}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Target URL for "${context}" must use http or https protocol, got "${parsed.protocol}"`,
    );
  }
}

function normalizeRouteMap(value: unknown): RouteMap {
  if (!isRecord(value)) {
    throw new Error('ROUTE_MAP must be a JSON object');
  }

  const normalized: RouteMap = {};

  for (const [namespace, routeValue] of Object.entries(value)) {
    if (typeof routeValue === 'string') {
      validateTargetUrl(routeValue, namespace);
      normalized[namespace] = routeValue;
      continue;
    }

    if (!isRecord(routeValue)) {
      throw new Error(`ROUTE_MAP namespace "${namespace}" must be an object`);
    }

    // New versioned format: { versions: { v1: "http://..." }, public?: true, publicPaths?: [...] }
    if ('versions' in routeValue && isRecord(routeValue['versions'])) {
      const isPublicRoute = routeValue['public'] === true;
      const versionMap: Record<string, string> = {};
      for (const [version, target] of Object.entries(routeValue['versions'])) {
        if (typeof target !== 'string') {
          throw new Error(
            `ROUTE_MAP target for "${namespace}.${version}" must be a string URL`,
          );
        }
        validateTargetUrl(target, `${namespace}.${version}`);
        versionMap[version] = target;
      }
      const rawPublicPaths = routeValue['publicPaths'];
      const publicPaths: PublicPathRule[] = Array.isArray(rawPublicPaths)
        ? rawPublicPaths.map((entry, i) =>
            normalizePublicPath(entry, namespace, i),
          )
        : [];
      normalized[namespace] = {
        versions: versionMap,
        public: isPublicRoute,
        publicPaths,
      };
      continue;
    }

    // Legacy format: flat version map { v1: "http://...", v2: "http://..." }
    const versionMap: Record<string, string> = {};
    for (const [version, target] of Object.entries(routeValue)) {
      if (typeof target !== 'string') {
        throw new Error(
          `ROUTE_MAP target for "${namespace}.${version}" must be a string URL`,
        );
      }

      validateTargetUrl(target, `${namespace}.${version}`);
      versionMap[version] = target;
    }

    normalized[namespace] = versionMap;
  }

  return normalized;
}

function parseRouteMap(raw?: string): RouteMap {
  if (!raw) {
    throw new Error(
      'Route map is not configured. ' +
        'Set the ROUTE_MAP environment variable to a JSON route map, ' +
        'or set ROUTE_MAP_URL to a URL from which the route map JSON will be fetched at startup.',
    );
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRouteMap(parsed);
  } catch (err) {
    throw new Error(`Invalid ROUTE_MAP: ${String(err)}`, { cause: err });
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseScopes(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return ['openid', 'profile'];
  }

  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function parseCsv(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export default registerAs('gateway', () => ({
  jwtSecret: process.env.JWT_HMAC_SECRET ?? 'change-me-in-production',
  jwtExpiresInSeconds: parseNumber(process.env.JWT_EXPIRES_IN_SECONDS, 3600),
  maxProxyRequestBodyBytes: parseNumber(
    process.env.MAX_PROXY_REQUEST_BODY_BYTES,
    1_048_576,
  ),
  proxyTimeoutMs: parseNumber(process.env.PROXY_TIMEOUT_MS, 15_000),
  proxyCircuitBreakerFailureThreshold: parseNumber(
    process.env.PROXY_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    3,
  ),
  proxyCircuitBreakerCooldownMs: parseNumber(
    process.env.PROXY_CIRCUIT_BREAKER_COOLDOWN_MS,
    10_000,
  ),
  rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMaxRequests: parseNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  routeMap: parseRouteMap(process.env.ROUTE_MAP),
  redisUrl: process.env.REDIS_URL,
  oauth2Issuer: process.env.OAUTH2_ISSUER ?? '',
  oauth2Audience: process.env.OAUTH2_AUDIENCE ?? '',
  oauth2: {
    server: process.env.OAUTH2_SERVER ?? '',
    clientId: process.env.OAUTH2_CLIENT_ID ?? '',
    clientSecret: process.env.OAUTH2_CLIENT_SECRET ?? '',
    redirectUri: process.env.OAUTH2_REDIRECT_URI ?? '',
    scopes: parseScopes(process.env.OAUTH2_SCOPES),
    defaultScope: parseScopes(process.env.OAUTH2_SCOPES).join(' '),
  },
  corsOrigins: parseCsv(process.env.CORS_ORIGINS, ['http://localhost:5173']),
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseNumber(process.env.DB_PORT, 3306),
    username: process.env.DB_USERNAME ?? 'gatekeeper',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'gatekeeper',
    charset: process.env.DB_CHARSET ?? 'utf8mb4',
    synchronize: parseBoolean(process.env.DB_SYNCHRONIZE, false),
    migrationsRun: parseBoolean(process.env.DB_MIGRATIONS_RUN, true),
    logging: parseBoolean(process.env.DB_LOGGING, false),
  },
}));
