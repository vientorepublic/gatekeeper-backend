import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { DataSource } from 'typeorm';

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

    const results = await Promise.allSettled([
      this.closeDatabaseConnection(),
      this.closeCacheStores(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Failed to close application resources',
      );
    }

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
    const results = await Promise.allSettled(
      this.cacheManager.stores.map((store) => store.disconnect()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to disconnect cache stores');
    }

    this.logger.log('Cache stores disconnected');
  }
}
