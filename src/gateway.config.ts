import { registerAs } from '@nestjs/config';
import type { RouteMap } from './gateway.types';

function parseRouteMap(raw?: string): RouteMap {
  if (!raw) {
    return {
      'orders:v1': 'http://localhost:4001',
      'billing:v1': 'http://localhost:4002',
    };
  }

  try {
    const parsed = JSON.parse(raw) as RouteMap;
    return parsed;
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
