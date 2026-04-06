import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
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

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeysRepository: Repository<ApiKeyEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async listApiKeys(
    userId: string,
    namespace: string,
  ): Promise<UserApiKeyView[]> {
    this.assertManagedNamespace(namespace);

    const apiKeys = await this.apiKeysRepository.find({
      where: {
        userId,
        namespace,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return apiKeys.map((apiKey) => ({
      id: apiKey.id,
      namespace: apiKey.namespace,
      prefix: apiKey.keyPrefix,
      label: apiKey.label,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
    }));
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

    const apiKey = await this.apiKeysRepository.findOne({
      where: {
        keyHash,
        revokedAt: IsNull(),
        ...(namespace ? { namespace } : {}),
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    apiKey.lastUsedAt = new Date();
    await this.apiKeysRepository.save(apiKey);

    const user = await this.usersRepository.findOne({
      where: {
        id: apiKey.userId,
      },
    });

    if (!user) {
      throw new UnauthorizedException('API key user not found');
    }

    return user;
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
