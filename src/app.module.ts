import { CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import gatewayConfig from './config/gateway.config';
import { GatewayController } from './modules/gateway/gateway.controller';
import { GatewayProxyMiddleware } from './modules/gateway/gateway-proxy.middleware';
import { HealthController } from './modules/health/health.controller';
import { IdentityService } from './modules/auth/identity.service';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RouteRegistryService } from './modules/gateway/route-registry.service';
import { redisStore } from 'cache-manager-redis-store';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [gatewayConfig],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('gateway.redisUrl', {
          infer: true,
        });

        if (!redisUrl) {
          return {
            ttl: 60_000,
          };
        }

        return {
          store: await redisStore({
            url: redisUrl,
          }),
          ttl: 60_000,
        };
      },
    }),
  ],
  controllers: [HealthController, GatewayController],
  providers: [
    RouteRegistryService,
    IdentityService,
    JwtAuthGuard,
    GatewayProxyMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GatewayProxyMiddleware).forRoutes(GatewayController);
  }
}
