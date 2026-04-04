import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import type { ResolvedRoute, RouteMap } from '../../common/types/gateway.types';

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
    const cacheKey = `route:${namespace}:${version}`;
    const cached = await this.cacheManager.get<ResolvedRoute>(cacheKey);
    if (cached) {
      return cached;
    }

    const routeMap = this.configService.get<RouteMap>('gateway.routeMap');
    const namespaceEntry = routeMap?.[namespace];
    if (!namespaceEntry) {
      return undefined;
    }

    const resolved =
      typeof namespaceEntry === 'string'
        ? { target: namespaceEntry, keepVersionPrefix: true }
        : (() => {
            const target = namespaceEntry[version];
            if (!target) {
              return undefined;
            }

            return {
              target,
              keepVersionPrefix: false,
            } satisfies ResolvedRoute;
          })();

    if (resolved) {
      await this.cacheManager.set(cacheKey, resolved, 60_000);
    }

    return resolved;
  }
}
