import { registerAs } from '@nestjs/config';
import type { RouteMap } from '../common/types/gateway.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeRouteMap(value: unknown): RouteMap {
  if (!isRecord(value)) {
    throw new Error('ROUTE_MAP must be a JSON object');
  }

  const normalized: RouteMap = {};

  for (const [namespace, routeValue] of Object.entries(value)) {
    if (typeof routeValue === 'string') {
      normalized[namespace] = routeValue;
      continue;
    }

    if (!isRecord(routeValue)) {
      throw new Error(`ROUTE_MAP namespace "${namespace}" must be an object`);
    }

    const versionMap: Record<string, string> = {};
    for (const [version, target] of Object.entries(routeValue)) {
      if (typeof target !== 'string') {
        throw new Error(
          `ROUTE_MAP target for "${namespace}.${version}" must be a string URL`,
        );
      }

      versionMap[version] = target;
    }

    normalized[namespace] = versionMap;
  }

  return normalized;
}

function parseRouteMap(raw?: string): RouteMap {
  if (!raw) {
    throw new Error('ROUTE_MAP environment variable is required');
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRouteMap(parsed);
  } catch {
    throw new Error('Invalid ROUTE_MAP JSON format');
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
    defaultScope: process.env.OAUTH2_SCOPES ?? 'openid,profile',
  },
  corsOrigins: parseCsv(process.env.CORS_ORIGINS, ['http://localhost:5173']),
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseNumber(process.env.DB_PORT, 3306),
    username: process.env.DB_USERNAME ?? 'gatekeeper',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'gatekeeper',
    charset: process.env.DB_CHARSET ?? 'utf8mb4',
    synchronize: parseBoolean(process.env.DB_SYNCHRONIZE, true),
    logging: parseBoolean(process.env.DB_LOGGING, false),
  },
}));
