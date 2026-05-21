import { CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import gatewayConfig from './config/gateway.config';
import type { DatabaseConfig } from './config/gateway.config';
import { GatewayController } from './modules/gateway/gateway.controller';
import { GatewayProxyMiddleware } from './modules/gateway/gateway-proxy.middleware';
import { HealthController } from './modules/health/health.controller';
import { UserEntity } from './modules/auth/entities/user.entity';
import { ApiKeyEntity } from './modules/auth/entities/api-key.entity';
import { RouteRegistryService } from './modules/gateway/route-registry.service';
import { GracefulShutdownService } from './common/lifecycle/graceful-shutdown.service';
import { HealthMetricsModule } from './modules/health/health-metrics.module';
import { CronJobsModule } from './modules/cron/cron-jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { InitialAuthSchema20260409000000 } from './migrations/20260409000000-initial-auth-schema.migration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [gatewayConfig],
    }),
    // 30 requests per minute per IP across all auth/health routes.
    // GatewayController routes are excluded via @SkipThrottle() because
    // the proxy middleware applies its own per-IP rate limiting.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    ScheduleModule.forRoot(),
    HealthMetricsModule,
    CronJobsModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.get<DatabaseConfig>('gateway.database')!;

        return {
          type: 'mariadb' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          charset: db.charset,
          entities: [UserEntity, ApiKeyEntity],
          migrations: [InitialAuthSchema20260409000000],
          migrationsRun: db.migrationsRun,
          synchronize: db.synchronize,
          logging: db.logging,
        };
      },
    }),
    AuthModule,
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrlValue = configService.get<unknown>('gateway.redisUrl');
        const redisUrl =
          typeof redisUrlValue === 'string' ? redisUrlValue : undefined;

        if (!redisUrl) {
          return {
            ttl: 60_000,
          };
        }

        const redisKeyvStore = new KeyvRedis(redisUrl);
        const redisKeyv = new Keyv({
          store: redisKeyvStore,
          namespace: 'gatekeeper',
        });

        // Fail fast when REDIS_URL is configured but cache backend is unreachable.
        const probeKey = '__gatekeeper:redis:probe__';
        await redisKeyv.set(probeKey, 'ok', 3_000);
        const probeValue = await redisKeyv.get<string>(probeKey);
        if (probeValue !== 'ok') {
          throw new Error('Redis cache probe failed');
        }
        await redisKeyv.delete(probeKey);

        return {
          stores: [redisKeyv],
          ttl: 60_000,
        };
      },
    }),
  ],
  controllers: [HealthController, GatewayController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    RouteRegistryService,
    GracefulShutdownService,
    GatewayProxyMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GatewayProxyMiddleware).forRoutes(GatewayController);
  }
}
