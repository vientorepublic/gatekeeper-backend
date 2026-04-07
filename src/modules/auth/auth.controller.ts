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
import type { GatewayUserIdentity } from '../../common/types/gateway.types';
import { ConfigService } from '@nestjs/config';
import type { RouteMap } from '../../common/types/gateway.types';
import {
  ApiKeyRequestBodyDto,
  OAuth2CallbackQueryDto,
  OAuth2RefreshRequestBodyDto,
  OAuth2SessionRequestBodyDto,
} from './dto/auth.dto';
import type {
  ApiKeyIssueResponseDto,
  ApiKeyListResponseDto,
  ApiKeyRevokeResponseDto,
  NamespacesResponseDto,
  OAuth2AuthorizeResponseDto,
  OAuth2RefreshResponseDto,
  OAuth2SessionResponseDto,
} from './dto/auth.dto';

interface OAuth2GatewaySessionResult {
  accessToken: string;
  user: {
    id: string;
    provider: string;
    subject: string;
    email: string | null;
    name: string | null;
  };
}

interface OAuth2GatewayRefreshResult extends OAuth2GatewaySessionResult {
  refreshToken: string | null;
  oauthAccessTokenExpiresIn: number | null;
}

type Oauth2ServiceContract = {
  createAuthorizationRequest: () => Promise<{
    authUrl: string;
    state: string;
  }>;
  completeAuthorizationCodeGrant: (
    code: string,
    state: string,
  ) => Promise<OAuth2GatewayRefreshResult>;
  createSessionFromAccessToken: (
    accessToken: string,
    scope?: string,
  ) => Promise<OAuth2GatewaySessionResult>;
  refreshSessionFromRefreshToken: (
    refreshToken: string,
  ) => Promise<OAuth2GatewayRefreshResult>;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oauth2Service: Oauth2Service,
    private readonly apiKeysService: ApiKeysService,
    private readonly configService: ConfigService,
  ) {}

  private get oauth2(): Oauth2ServiceContract {
    return this.oauth2Service as unknown as Oauth2ServiceContract;
  }

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

  @Get('oauth2/authorize')
  async getAuthorizeUrl(): Promise<OAuth2AuthorizeResponseDto> {
    const payload = await this.oauth2.createAuthorizationRequest();

    return {
      authorizeUrl: payload.authUrl,
      state: payload.state,
    };
  }

  @Get('oauth2/callback')
  async handleOAuth2Callback(
    @Query() query: OAuth2CallbackQueryDto,
  ): Promise<OAuth2RefreshResponseDto> {
    const result = await this.oauth2.completeAuthorizationCodeGrant(
      query.code,
      query.state,
    );

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      oauthAccessTokenExpiresIn: result.oauthAccessTokenExpiresIn,
      tokenType: 'Bearer',
      user: {
        id: result.user.id,
        provider: result.user.provider,
        subject: result.user.subject,
        email: result.user.email,
        name: result.user.name,
      },
    };
  }

  @Post('oauth2/session')
  async createOAuth2Session(
    @Body() body: OAuth2SessionRequestBodyDto,
  ): Promise<OAuth2SessionResponseDto> {
    const result = await this.oauth2.createSessionFromAccessToken(
      body.accessToken,
      body.scope,
    );

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      user: {
        id: result.user.id,
        provider: result.user.provider,
        subject: result.user.subject,
        email: result.user.email,
        name: result.user.name,
      },
    };
  }

  @Post('oauth2/refresh')
  async refreshOAuth2Session(
    @Body() body: OAuth2RefreshRequestBodyDto,
  ): Promise<OAuth2RefreshResponseDto> {
    const result = await this.oauth2.refreshSessionFromRefreshToken(
      body.refreshToken,
    );

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      oauthAccessTokenExpiresIn: result.oauthAccessTokenExpiresIn,
      tokenType: 'Bearer',
      user: {
        id: result.user.id,
        provider: result.user.provider,
        subject: result.user.subject,
        email: result.user.email,
        name: result.user.name,
      },
    };
  }

  @Get('api-keys/:namespace')
  @UseGuards(JwtAuthGuard)
  async listApiKeys(
    @Req() req: Request & { user?: GatewayUserIdentity },
    @Param('namespace') namespace: string,
  ): Promise<ApiKeyListResponseDto> {
    const user = req.user;
    if (!user?.userId) {
      throw new UnauthorizedException('Authenticated user is required');
    }

    return this.apiKeysService.listApiKeys(user.userId, namespace);
  }

  @Post('api-keys/:namespace')
  @UseGuards(JwtAuthGuard)
  async issueApiKey(
    @Req() req: Request & { user?: GatewayUserIdentity },
    @Param('namespace') namespace: string,
    @Body() body: ApiKeyRequestBodyDto,
  ): Promise<ApiKeyIssueResponseDto> {
    const user = req.user;
    if (!user?.userId) {
      throw new UnauthorizedException('Authenticated user is required');
    }

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
    const user = req.user;
    if (!user?.userId) {
      throw new UnauthorizedException('Authenticated user is required');
    }

    const revoked = await this.apiKeysService.revokeApiKey(
      user.userId,
      namespace,
      id,
    );
    return { revoked };
  }
}
