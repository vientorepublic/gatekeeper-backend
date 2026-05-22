import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import gatewayConfig from './config/gateway.config';
import { GracefulShutdownService } from './common/lifecycle/graceful-shutdown.service';
import { DatabaseModule } from './database/database.module';
import { CacheConfigModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { CronJobsModule } from './modules/cron/cron-jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [gatewayConfig],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CacheConfigModule,
    AuthModule,
    HealthModule,
    GatewayModule,
    CronJobsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    GracefulShutdownService,
  ],
})
export class AppModule {}
