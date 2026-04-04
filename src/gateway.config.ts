import { registerAs } from '@nestjs/config';
import type { RouteMap } from './gateway.types';

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
    return {
      orders: {
        v1: 'http://localhost:4001',
        v2: 'http://localhost:4003',
      },
      billing: 'http://localhost:4002',
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRouteMap(parsed);
  } catch {
    throw new Error('Invalid ROUTE_MAP JSON format');
  }
}

export default registerAs('gateway', () => ({
  jwtSecret: process.env.JWT_HMAC_SECRET ?? 'change-me-in-production',
  routeMap: parseRouteMap(process.env.ROUTE_MAP),
  redisUrl: process.env.REDIS_URL,
  oauth2Issuer: process.env.OAUTH2_ISSUER ?? '',
  oauth2Audience: process.env.OAUTH2_AUDIENCE ?? '',
}));
