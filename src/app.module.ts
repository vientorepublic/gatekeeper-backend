import { CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { TypeOrmModule } from '@nestjs/typeorm';
import gatewayConfig from './config/gateway.config';
import { GatewayController } from './modules/gateway/gateway.controller';
import { GatewayProxyMiddleware } from './modules/gateway/gateway-proxy.middleware';
import { HealthController } from './modules/health/health.controller';
import { AuthController } from './modules/auth/auth.controller';
import { IdentityService } from './modules/auth/identity.service';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { Oauth2Service } from './modules/auth/oauth2.service';
import { UsersService } from './modules/auth/users.service';
import { ApiKeysService } from './modules/auth/api-keys.service';
import { UserEntity } from './modules/auth/entities/user.entity';
import { ApiKeyEntity } from './modules/auth/entities/api-key.entity';
import { RouteRegistryService } from './modules/gateway/route-registry.service';
import { GracefulShutdownService } from './common/lifecycle/graceful-shutdown.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [gatewayConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const hostValue = configService.get<unknown>('gateway.database.host');
        const portValue = configService.get<unknown>('gateway.database.port');
        const usernameValue = configService.get<unknown>(
          'gateway.database.username',
        );
        const passwordValue = configService.get<unknown>(
          'gateway.database.password',
        );
        const databaseNameValue = configService.get<unknown>(
          'gateway.database.database',
        );
        const charsetValue = configService.get<unknown>(
          'gateway.database.charset',
        );
        const synchronizeValue = configService.get<unknown>(
          'gateway.database.synchronize',
        );
        const loggingValue = configService.get<unknown>(
          'gateway.database.logging',
        );

        const host = typeof hostValue === 'string' ? hostValue : '127.0.0.1';
        const port = typeof portValue === 'number' ? portValue : 3306;
        const username =
          typeof usernameValue === 'string' ? usernameValue : 'gatekeeper';
        const password = typeof passwordValue === 'string' ? passwordValue : '';
        const database =
          typeof databaseNameValue === 'string'
            ? databaseNameValue
            : 'gatekeeper';
        const charset =
          typeof charsetValue === 'string' ? charsetValue : 'utf8mb4';
        const synchronize =
          typeof synchronizeValue === 'boolean' ? synchronizeValue : true;
        const logging =
          typeof loggingValue === 'boolean' ? loggingValue : false;

        return {
          type: 'mariadb' as const,
          host,
          port,
          username,
          password,
          database,
          charset,
          entities: [UserEntity, ApiKeyEntity],
          synchronize,
          logging,
        };
      },
    }),
    TypeOrmModule.forFeature([UserEntity, ApiKeyEntity]),
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
  controllers: [HealthController, GatewayController, AuthController],
  providers: [
    RouteRegistryService,
    IdentityService,
    JwtAuthGuard,
    Oauth2Service,
    UsersService,
    ApiKeysService,
    GracefulShutdownService,
    GatewayProxyMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GatewayProxyMiddleware).forRoutes(GatewayController);
  }
}
