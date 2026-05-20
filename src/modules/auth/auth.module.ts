import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { IdentityService } from './identity.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Oauth2Service } from './oauth2.service';
import { UsersService } from './users.service';
import { ApiKeysService } from './api-keys.service';
import { UserEntity } from './entities/user.entity';
import { ApiKeyEntity } from './entities/api-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ApiKeyEntity])],
  controllers: [AuthController],
  providers: [
    IdentityService,
    JwtAuthGuard,
    Oauth2Service,
    UsersService,
    ApiKeysService,
  ],
  exports: [JwtAuthGuard, ApiKeysService, IdentityService],
})
export class AuthModule {}
