import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import type { Cache } from 'cache-manager';
import { ApiKeyEntity } from './entities/api-key.entity';
import { UserEntity } from './entities/user.entity';
import type { RouteMap } from '../../common/types/gateway.types';

export interface IssuedApiKey {
  apiKey: ApiKeyEntity;
  plainTextKey: string;
}

export interface UserApiKeyView {
  id: string;
  namespace: string;
  prefix: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface PaginatedUserApiKeys {
  items: UserApiKeyView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

interface CachedAuthenticatedApiKey {
  user: UserEntity;
  apiKeyId: string;
}

@Injectable()
export class ApiKeysService {
  private static readonly AUTH_CACHE_TTL_MS = 30_000;
  private readonly lastUsedAtThrottle = new Map<string, number>();
  private readonly lastUsedAtUpdateIntervalMs = 60_000;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeysRepository: Repository<ApiKeyEntity>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async listApiKeys(
    userId: string,
    namespace: string,
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedUserApiKeys> {
    this.assertManagedNamespace(namespace);

    const normalizedPage = Math.max(1, Math.trunc(page));
    const normalizedPageSize = Math.max(1, Math.trunc(pageSize));

    const total = await this.apiKeysRepository.count({
      where: {
        userId,
        namespace,
      },
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedPageSize);
    const effectivePage =
      totalPages === 0 ? 1 : Math.min(normalizedPage, totalPages);

    const apiKeys = await this.apiKeysRepository.find({
      where: {
        userId,
        namespace,
      },
      order: {
        createdAt: 'DESC',
      },
      skip: (effectivePage - 1) * normalizedPageSize,
      take: normalizedPageSize,
    });

    return {
      items: apiKeys.map((apiKey) => ({
        id: apiKey.id,
        namespace: apiKey.namespace,
        prefix: apiKey.keyPrefix,
        label: apiKey.label,
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
      })),
      page: effectivePage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      hasNext: totalPages > 0 && effectivePage < totalPages,
      hasPrevious: totalPages > 0 && effectivePage > 1,
    };
  }

  async issueApiKey(
    userId: string,
    namespace: string,
    label?: string,
  ): Promise<IssuedApiKey> {
    this.assertManagedNamespace(namespace);

    const randomPart = randomBytes(32).toString('hex');
    const plainTextKey = `gk_${randomPart}`;
    const keyHash = this.hashApiKey(plainTextKey);

    const apiKey = this.apiKeysRepository.create({
      userId,
      namespace,
      keyPrefix: plainTextKey.slice(0, 18),
      keyHash,
      label: label?.trim() || null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const saved = await this.apiKeysRepository.save(apiKey);
    return { apiKey: saved, plainTextKey };
  }

  async revokeApiKey(
    userId: string,
    namespace: string,
    apiKeyId: string,
  ): Promise<boolean> {
    this.assertManagedNamespace(namespace);

    const target = await this.apiKeysRepository.findOne({
      where: {
        id: apiKeyId,
        userId,
        namespace,
      },
    });

    if (!target || target.revokedAt) {
      return false;
    }

    target.revokedAt = new Date();
    await this.apiKeysRepository.save(target);
    await this.invalidateAuthCacheByHash(target.keyHash, target.namespace);
    this.lastUsedAtThrottle.delete(target.id);
    return true;
  }

  async authenticateApiKey(
    rawKey: string,
    namespace?: string,
  ): Promise<UserEntity> {
    if (namespace) {
      this.assertManagedNamespace(namespace);
    }

    const keyHash = this.hashApiKey(rawKey);
    const now = Date.now();
    const cacheKey = this.createAuthCacheKey(keyHash, namespace);
    const cached =
      await this.cacheManager.get<CachedAuthenticatedApiKey>(cacheKey);

    if (cached) {
      this.touchLastUsedAtThrottled(cached.apiKeyId, now);
      return cached.user;
    }

    const apiKey = await this.apiKeysRepository.findOne({
      where: {
        keyHash,
        revokedAt: IsNull(),
        ...(namespace ? { namespace } : {}),
      },
      relations: {
        user: true,
      },
    });

    if (!apiKey || !apiKey.user) {
      throw new UnauthorizedException('Invalid API key');
    }

    await this.cacheManager.set(
      cacheKey,
      { user: apiKey.user, apiKeyId: apiKey.id },
      ApiKeysService.AUTH_CACHE_TTL_MS,
    );

    this.touchLastUsedAtThrottled(apiKey.id, now);

    return apiKey.user;
  }

  private createAuthCacheKey(keyHash: string, namespace?: string): string {
    return `authCache:${namespace ?? '*'}:${keyHash}`;
  }

  private async invalidateAuthCacheByHash(
    keyHash: string,
    namespace: string,
  ): Promise<void> {
    // Delete both the namespace-scoped and wildcard-scoped cache entries.
    await Promise.all([
      this.cacheManager.del(this.createAuthCacheKey(keyHash, namespace)),
      this.cacheManager.del(this.createAuthCacheKey(keyHash, undefined)),
    ]);
  }

  private touchLastUsedAtThrottled(apiKeyId: string, now: number): void {
    const lastUpdatedAt = this.lastUsedAtThrottle.get(apiKeyId) ?? 0;
    if (now - lastUpdatedAt < this.lastUsedAtUpdateIntervalMs) {
      return;
    }

    this.lastUsedAtThrottle.set(apiKeyId, now);

    void this.apiKeysRepository
      .update(
        {
          id: apiKeyId,
        },
        {
          lastUsedAt: new Date(now),
        },
      )
      .catch(() => {
        this.lastUsedAtThrottle.delete(apiKeyId);
      });
  }

  private hashApiKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private assertManagedNamespace(namespace: string): void {
    if (!namespace || namespace.trim().length === 0) {
      throw new BadRequestException('namespace is required');
    }

    const routeMap = this.configService.get<RouteMap>('gateway.routeMap', {
      infer: true,
    });
    const normalized = namespace.trim();

    if (
      !routeMap ||
      !Object.prototype.hasOwnProperty.call(routeMap, normalized)
    ) {
      throw new BadRequestException(
        `Unknown namespace "${normalized}". It must exist in ROUTE_MAP.`,
      );
    }
  }
}
