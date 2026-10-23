import type { PublicPathRule, RouteMap } from '../common/types/gateway.types';
import { isRecord } from '../common/utils/validation.utils';

function normalizePublicPath(
  entry: unknown,
  namespace: string,
  index: number,
): PublicPathRule {
  if (typeof entry === 'string') {
    if (entry.trim().length === 0) {
      throw new Error(
        `ROUTE_MAP publicPaths[${index}] for "${namespace}" must be a non-empty string`,
      );
    }
    return { path: entry };
  }

  if (isRecord(entry) && typeof entry['path'] === 'string') {
    if (!entry.path.trim()) {
      throw new Error(
        `ROUTE_MAP publicPaths[${index}] for "${namespace}" has an empty path`,
      );
    }
    const rule: PublicPathRule = { path: entry['path'] };
    const methods: unknown = entry.methods;
    if (methods !== undefined) {
      if (
        !Array.isArray(methods) ||
        methods.length === 0 ||
        !methods.every(
          (method): method is string =>
            typeof method === 'string' && method.trim().length > 0,
        )
      ) {
        throw new Error(
          `ROUTE_MAP publicPaths[${index}] for "${namespace}" requires a non-empty string array of methods`,
        );
      }
      rule.methods = methods.map((method) => method.trim().toUpperCase());
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
    throw new Error(`Invalid URL for "${context}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Target URL for "${context}" must use http or https protocol, got "${parsed.protocol}"`,
    );
  }
}

export function normalizeRouteMap(value: unknown): RouteMap {
  if (!isRecord(value)) {
    throw new Error('ROUTE_MAP must be a JSON object');
  }

  const entries: [string, RouteMap[string]][] = [];

  for (const [namespace, routeValue] of Object.entries(value)) {
    if (typeof routeValue === 'string') {
      validateTargetUrl(routeValue, namespace);
      entries.push([namespace, routeValue]);
      continue;
    }

    if (!isRecord(routeValue)) {
      throw new Error(`ROUTE_MAP namespace "${namespace}" must be an object`);
    }

    // New versioned format: { versions: { v1: "http://..." }, public?: true, publicPaths?: [...] }
    if ('versions' in routeValue && isRecord(routeValue['versions'])) {
      const isPublicRoute = routeValue['public'] === true;
      if (
        routeValue.public !== undefined &&
        typeof routeValue.public !== 'boolean'
      ) {
        throw new Error(
          `ROUTE_MAP public flag for "${namespace}" must be a boolean`,
        );
      }
      const versions: [string, string][] = [];
      for (const [version, target] of Object.entries(routeValue['versions'])) {
        if (typeof target !== 'string') {
          throw new Error(
            `ROUTE_MAP target for "${namespace}.${version}" must be a string URL`,
          );
        }
        validateTargetUrl(target, `${namespace}.${version}`);
        versions.push([version, target]);
      }
      const rawPublicPaths = routeValue['publicPaths'];
      if (rawPublicPaths !== undefined && !Array.isArray(rawPublicPaths)) {
        throw new Error(
          `ROUTE_MAP publicPaths for "${namespace}" must be an array`,
        );
      }
      const publicPaths: PublicPathRule[] = Array.isArray(rawPublicPaths)
        ? rawPublicPaths.map((entry, i) =>
            normalizePublicPath(entry, namespace, i),
          )
        : [];
      entries.push([
        namespace,
        {
          versions: Object.fromEntries(versions),
          public: isPublicRoute,
          publicPaths,
        },
      ]);
      continue;
    }

    // Legacy format: flat version map { v1: "http://...", v2: "http://..." }
    const versions: [string, string][] = [];
    for (const [version, target] of Object.entries(routeValue)) {
      if (typeof target !== 'string') {
        throw new Error(
          `ROUTE_MAP target for "${namespace}.${version}" must be a string URL`,
        );
      }

      validateTargetUrl(target, `${namespace}.${version}`);
      versions.push([version, target]);
    }

    entries.push([namespace, Object.fromEntries(versions)]);
  }

  return Object.fromEntries(entries);
}

export function parseRouteMap(raw?: string): RouteMap {
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
