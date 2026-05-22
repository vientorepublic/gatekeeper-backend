import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DatabaseConfig } from '../config/gateway.config';
import { UserEntity } from '../modules/auth/entities/user.entity';
import { ApiKeyEntity } from '../modules/auth/entities/api-key.entity';
import { InitialAuthSchema20260409000000 } from '../migrations/20260409000000-initial-auth-schema.migration';

@Module({
  imports: [
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
  ],
})
export class DatabaseModule {}
