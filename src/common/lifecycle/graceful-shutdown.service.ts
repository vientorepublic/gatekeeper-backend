import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';

interface DisconnectableStore {
  disconnect: () => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDisconnectableStore(value: unknown): value is DisconnectableStore {
  return isRecord(value) && typeof value.disconnect === 'function';
}

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Received ${signal ?? 'shutdown signal'}. Starting graceful shutdown...`,
    );

    await this.closeDatabaseConnection();
    await this.closeCacheStores();

    this.logger.log('Graceful shutdown completed');
  }

  private async closeDatabaseConnection(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      return;
    }

    await this.dataSource.destroy();
    this.logger.log('Database connection closed');
  }

  private async closeCacheStores(): Promise<void> {
    const manager = this.cacheManager as unknown;
    if (!isRecord(manager)) {
      return;
    }

    const stores = manager.stores;
    if (!Array.isArray(stores)) {
      return;
    }

    for (const store of stores) {
      if (!isDisconnectableStore(store)) {
        continue;
      }

      await store.disconnect();
    }

    this.logger.log('Cache stores disconnected');
  }
}
