import { CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GatewayController } from './gateway.controller';
import gatewayConfig from './gateway.config';
import { GatewayProxyMiddleware } from './gateway-proxy.middleware';
import { HealthController } from './health.controller';
import { IdentityService } from './identity.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RouteRegistryService } from './route-registry.service';
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
