import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';

@Module({
  imports: [
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
})
export class CacheConfigModule {}
