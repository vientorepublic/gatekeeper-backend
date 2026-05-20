import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  ParseUUIDPipe,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Oauth2Service } from './oauth2.service';
import { UserEntity } from './entities/user.entity';
import type { GatewayUserIdentity } from '../../common/types/gateway.types';
import { ConfigService } from '@nestjs/config';
import type { RouteMap } from '../../common/types/gateway.types';
import { isVersionedNamespaceRoute } from '../../common/utils/gateway-route.utils';
import {
  ApiKeyListQueryDto,
  ApiKeyRequestBodyDto,
  OAuth2CallbackQueryDto,
  OAuth2RefreshRequestBodyDto,
  OAuth2SessionRequestBodyDto,
} from './dto/auth.dto';
import type {
  RouteGuideNamespaceDto,
  RouteGuideResponseDto,
  ApiKeyIssueResponseDto,
  ApiKeyListResponseDto,
  ApiKeyRevokeResponseDto,
  NamespacesResponseDto,
  OAuth2AuthorizeResponseDto,
  OAuth2RefreshResponseDto,
  OAuth2SessionResponseDto,
  OAuth2UserDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oauth2Service: Oauth2Service,
    private readonly apiKeysService: ApiKeysService,
    private readonly configService: ConfigService,
  ) {}

  @Get('namespaces')
  getNamespaces(): NamespacesResponseDto {
    const routeMap = this.configService.get<RouteMap>('gateway.routeMap', {
      infer: true,
    });

    if (!routeMap) {
      throw new ConflictException('ROUTE_MAP is not configured');
    }

    return {
      namespaces: Object.keys(routeMap),
    };
  }

  @Get('route-map')
  @UseGuards(JwtAuthGuard)
  getRouteGuide(): RouteGuideResponseDto {
    const routeMap = this.configService.get<RouteMap>('gateway.routeMap', {
      infer: true,
    });

    if (!routeMap) {
      throw new ConflictException('ROUTE_MAP is not configured');
    }

    const namespaces = Object.entries(routeMap)
      .map(([namespace, entry]) => {
        const routeGuide: RouteGuideNamespaceDto =
          typeof entry === 'string'
            ? {
                namespace,
                supportsAnyVersion: true,
                versions: [],
              }
            : {
                namespace,
                supportsAnyVersion: false,
                versions: Object.keys(
                  isVersionedNamespaceRoute(entry)
                    ? entry.versions
                    : (entry as Record<string, unknown>),
                ).sort((left, right) => left.localeCompare(right)),
              };

        return routeGuide;
      })
      .sort((left, right) => left.namespace.localeCompare(right.namespace));

    return { namespaces };
  }

  @Get('oauth2/authorize')
  async getAuthorizeUrl(): Promise<OAuth2AuthorizeResponseDto> {
    const payload = await this.oauth2Service.createAuthorizationRequest();

    return {
      authorizeUrl: payload.authUrl,
      state: payload.state,
    };
  }

  @Get('oauth2/callback')
  async handleOAuth2Callback(
    @Query() query: OAuth2CallbackQueryDto,
  ): Promise<OAuth2RefreshResponseDto> {
    const result = await this.oauth2Service.completeAuthorizationCodeGrant(
      query.code,
      query.state,
    );

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      oauthAccessTokenExpiresIn: result.oauthAccessTokenExpiresIn,
      tokenType: 'Bearer',
      user: this.toUserDto(result.user),
    };
  }

  @Post('oauth2/session')
  async createOAuth2Session(
    @Body() body: OAuth2SessionRequestBodyDto,
  ): Promise<OAuth2SessionResponseDto> {
    const result = await this.oauth2Service.createSessionFromAccessToken(
      body.accessToken,
      body.scope,
    );

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      user: this.toUserDto(result.user),
    };
  }

  @Post('oauth2/refresh')
  async refreshOAuth2Session(
    @Body() body: OAuth2RefreshRequestBodyDto,
  ): Promise<OAuth2RefreshResponseDto> {
    const result = await this.oauth2Service.refreshSessionFromRefreshToken(
      body.refreshToken,
    );

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      oauthAccessTokenExpiresIn: result.oauthAccessTokenExpiresIn,
      tokenType: 'Bearer',
      user: this.toUserDto(result.user),
    };
  }

  @Get('api-keys/:namespace')
  @UseGuards(JwtAuthGuard)
  async listApiKeys(
    @Req() req: Request & { user?: GatewayUserIdentity },
    @Param('namespace') namespace: string,
    @Query() query: ApiKeyListQueryDto,
  ): Promise<ApiKeyListResponseDto> {
    const user = this.requireUser(req);

    return this.apiKeysService.listApiKeys(
      user.userId,
      namespace,
      query.page,
      query.pageSize,
    );
  }

  @Post('api-keys/:namespace')
  @UseGuards(JwtAuthGuard)
  async issueApiKey(
    @Req() req: Request & { user?: GatewayUserIdentity },
    @Param('namespace') namespace: string,
    @Body() body: ApiKeyRequestBodyDto,
  ): Promise<ApiKeyIssueResponseDto> {
    const user = this.requireUser(req);

    const issued = await this.apiKeysService.issueApiKey(
      user.userId,
      namespace,
      body.label,
    );

    return {
      id: issued.apiKey.id,
      namespace: issued.apiKey.namespace,
      apiKey: issued.plainTextKey,
      prefix: issued.apiKey.keyPrefix,
      createdAt: issued.apiKey.createdAt,
      label: issued.apiKey.label,
    };
  }

  @Delete('api-keys/:namespace/:id')
  @UseGuards(JwtAuthGuard)
  async revokeApiKey(
    @Req() req: Request & { user?: GatewayUserIdentity },
    @Param('namespace') namespace: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ApiKeyRevokeResponseDto> {
    const user = this.requireUser(req);

    const revoked = await this.apiKeysService.revokeApiKey(
      user.userId,
      namespace,
      id,
    );
    return { revoked };
  }

  private requireUser(
    req: Request & { user?: GatewayUserIdentity },
  ): GatewayUserIdentity & { userId: string } {
    if (!req.user?.userId) {
      throw new UnauthorizedException('Authenticated user is required');
    }
    return req.user as GatewayUserIdentity & { userId: string };
  }

  private toUserDto(user: UserEntity): OAuth2UserDto {
    return {
      id: user.id,
      provider: user.provider,
      subject: user.subject,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }
}
