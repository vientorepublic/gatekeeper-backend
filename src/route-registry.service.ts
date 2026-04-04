import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import type { RouteMap } from './gateway.types';

@Injectable()
export class RouteRegistryService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getTarget(
    namespace: string,
    version: string,
  ): Promise<string | undefined> {
    const cacheKey = `route:${namespace}:${version}`;
    const cached = await this.cacheManager.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const routeMap = this.configService.get<RouteMap>('gateway.routeMap');
    const target = routeMap?.[`${namespace}:${version}`];

    if (target) {
      await this.cacheManager.set(cacheKey, target, 60_000);
    }

    return target;
  }
}
