import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import type { ResolvedRoute, RouteMap } from '../../common/types/gateway.types';
import { isVersionedNamespaceRoute } from '../../common/utils/gateway-route.utils';

@Injectable()
export class RouteRegistryService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getTarget(
    namespace: string,
    version: string,
  ): Promise<ResolvedRoute | undefined> {
    // encodeURIComponent prevents cache key collision when namespace or version
    // contain the ':' separator (e.g. namespace="ns:v1" vs version="v1").
    const cacheKey = `route:${encodeURIComponent(namespace)}:${encodeURIComponent(version)}`;
    const cached = await this.cacheManager.get<ResolvedRoute>(cacheKey);
    if (cached) {
      return cached;
    }

    const routeMap = this.configService.get<RouteMap>('gateway.routeMap');
    const namespaceEntry = routeMap?.[namespace];
    if (!namespaceEntry) {
      return undefined;
    }

    let resolved: ResolvedRoute | undefined;

    if (typeof namespaceEntry === 'string') {
      resolved = {
        target: namespaceEntry,
        keepVersionPrefix: true,
        isPublic: false,
        publicPaths: [],
      };
    } else if (isVersionedNamespaceRoute(namespaceEntry)) {
      const target = namespaceEntry.versions[version];
      if (!target) {
        return undefined;
      }
      resolved = {
        target,
        keepVersionPrefix: false,
        isPublic: namespaceEntry.public === true,
        publicPaths: namespaceEntry.publicPaths ?? [],
      };
    } else {
      // Legacy flat version map
      const target = namespaceEntry[version];
      if (!target) {
        return undefined;
      }
      resolved = {
        target,
        keepVersionPrefix: false,
        isPublic: false,
        publicPaths: [],
      };
    }

    if (resolved) {
      await this.cacheManager.set(cacheKey, resolved, 60_000);
    }

    return resolved;
  }
}
