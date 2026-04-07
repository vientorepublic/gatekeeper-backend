import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import type { Cache } from 'cache-manager';
import { FlowAuthClient, OAuth2Scope } from 'flowauth-oauth2-client';
import { UsersService, type OAuth2UserProfile } from './users.service';
import type { UserEntity } from './entities/user.entity';

interface OAuth2StatePayload {
  state: string;
  codeVerifier: string;
}

interface TokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

@Injectable()
export class Oauth2Service {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async createAuthorizationRequest(): Promise<{
    authUrl: string;
    state: string;
  }> {
    const client = this.createClient();
    const scopes = this.getScopes();
    const secureParams = await client.createSecureAuthorizeUrl(scopes);

    await this.cacheManager.set<OAuth2StatePayload>(
      this.getStateCacheKey(secureParams.state),
      {
        state: secureParams.state,
        codeVerifier: secureParams.codeVerifier,
      },
      10 * 60 * 1000,
    );

    return {
      authUrl: secureParams.authUrl,
      state: secureParams.state,
    };
  }

  async completeAuthorizationCodeGrant(
    code: string,
    state: string,
  ): Promise<{
    accessToken: string;
    user: UserEntity;
    refreshToken: string | null;
    oauthAccessTokenExpiresIn: number | null;
  }> {
    const statePayload = await this.cacheManager.get<OAuth2StatePayload>(
      this.getStateCacheKey(state),
    );

    if (!statePayload || statePayload.state !== state) {
      throw new BadRequestException('Invalid OAuth2 state');
    }

    const client = this.createClient();

    const tokens = await this.exchangeCodeForTokens(
      client,
      code,
      statePayload.codeVerifier,
    );

    if (!tokens.access_token) {
      throw new UnauthorizedException('OAuth2 token exchange failed');
    }

    await this.cacheManager.del(this.getStateCacheKey(state));

    const profile = await this.fetchProfile(client, tokens);
    const user = await this.usersService.upsertOAuth2User('flowauth', profile);

    const jwt = this.issueGatewayToken(user, tokens.scope);

    return {
      accessToken: jwt,
      user,
      refreshToken:
        typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
      oauthAccessTokenExpiresIn:
        typeof tokens.expires_in === 'number' ? tokens.expires_in : null,
    };
  }

  async createSessionFromAccessToken(
    accessToken: string,
    scope?: string,
  ): Promise<{ accessToken: string; user: UserEntity }> {
    const client = this.createClient();
    const profile = await this.fetchProfile(client, {
      access_token: accessToken,
      scope,
    });
    const user = await this.usersService.upsertOAuth2User('flowauth', profile);
    const jwt = this.issueGatewayToken(user, scope);

    return {
      accessToken: jwt,
      user,
    };
  }

  async refreshSessionFromRefreshToken(refreshToken: string): Promise<{
    accessToken: string;
    user: UserEntity;
    refreshToken: string | null;
    oauthAccessTokenExpiresIn: number | null;
  }> {
    const client = this.createClient();
    const refreshedTokens = await this.refreshAccessTokens(
      client,
      refreshToken,
    );

    if (!refreshedTokens.access_token) {
      throw new UnauthorizedException('OAuth2 token refresh failed');
    }

    const profile = await this.fetchProfile(client, refreshedTokens);
    const user = await this.usersService.upsertOAuth2User('flowauth', profile);
    const jwt = this.issueGatewayToken(user, refreshedTokens.scope);

    return {
      accessToken: jwt,
      user,
      refreshToken:
        typeof refreshedTokens.refresh_token === 'string'
          ? refreshedTokens.refresh_token
          : refreshToken,
      oauthAccessTokenExpiresIn:
        typeof refreshedTokens.expires_in === 'number'
          ? refreshedTokens.expires_in
          : null,
    };
  }

  private async fetchProfile(
    client: FlowAuthClient,
    tokens: TokenPayload,
  ): Promise<OAuth2UserProfile> {
    let userInfo: Record<string, unknown>;

    try {
      userInfo = (await client.getUserInfo(tokens.access_token)) as Record<
        string,
        unknown
      >;
    } catch (error) {
      const reason = this.getErrorMessage(error);
      throw new BadGatewayException(
        `OAuth2 userinfo request failed: ${reason}`,
      );
    }

    const subject = this.extractString(userInfo, ['sub', 'id', 'user_id']);
    if (!subject) {
      throw new UnauthorizedException('Unable to resolve OAuth2 subject');
    }

    return {
      sub: subject,
      email: this.extractString(userInfo, ['email']),
      name: this.extractString(userInfo, [
        'name',
        'nickname',
        'preferred_username',
      ]),
      avatarUrl: this.normalizeAvatarUrl(
        this.extractString(userInfo, [
          'picture',
          'avatar',
          'avatar_url',
          'profile_image_url',
          'image',
        ]),
      ),
      rawProfile: userInfo,
    };
  }

  private async exchangeCodeForTokens(
    client: FlowAuthClient,
    code: string,
    codeVerifier: string,
  ): Promise<TokenPayload> {
    try {
      return (await client.exchangeCode(code, codeVerifier)) as TokenPayload;
    } catch (error) {
      const reason = this.getErrorMessage(error);
      throw new BadGatewayException(`OAuth2 token exchange failed: ${reason}`);
    }
  }

  private async refreshAccessTokens(
    client: FlowAuthClient,
    refreshToken: string,
  ): Promise<TokenPayload> {
    try {
      return (await client.refreshToken(refreshToken)) as TokenPayload;
    } catch (error) {
      const reason = this.getErrorMessage(error);
      throw new BadGatewayException(`OAuth2 token refresh failed: ${reason}`);
    }
  }

  private issueGatewayToken(user: UserEntity, scopeClaim?: unknown): string {
    const jwtSecret = this.configService.get<string>('gateway.jwtSecret', {
      infer: true,
    });

    if (!jwtSecret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }

    const rawExpiresIn = this.configService.get<unknown>(
      'gateway.jwtExpiresInSeconds',
    );
    const expiresInSeconds =
      typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn)
        ? rawExpiresIn
        : 3600;

    const rawDefaultScope = this.configService.get<unknown>(
      'gateway.oauth2.defaultScope',
    );
    const defaultScope =
      typeof rawDefaultScope === 'string' ? rawDefaultScope : '';
    const scope = typeof scopeClaim === 'string' ? scopeClaim : defaultScope;

    return sign(
      {
        sub: user.subject,
        uid: user.id,
        provider: user.provider,
        scope,
      },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: expiresInSeconds,
      },
    );
  }

  private getScopes(): OAuth2Scope[] {
    const configuredScopes = this.configService.get<unknown>(
      'gateway.oauth2.scopes',
    );

    if (Array.isArray(configuredScopes)) {
      if (configuredScopes.length === 0) {
        return [OAuth2Scope.OPENID, OAuth2Scope.PROFILE];
      }

      return configuredScopes
        .filter((scope): scope is string => typeof scope === 'string')
        .map((scope) => scope as OAuth2Scope);
    }

    if (typeof configuredScopes !== 'string') {
      return [OAuth2Scope.OPENID, OAuth2Scope.PROFILE];
    }

    return configuredScopes
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0)
      .map((scope) => scope as OAuth2Scope);
  }

  private createClient(): FlowAuthClient {
    const server = this.configService.get<string>('gateway.oauth2.server', {
      infer: true,
    });
    const clientId = this.configService.get<string>('gateway.oauth2.clientId', {
      infer: true,
    });
    const clientSecret = this.configService.get<string>(
      'gateway.oauth2.clientSecret',
      {
        infer: true,
      },
    );
    const redirectUri = this.configService.get<string>(
      'gateway.oauth2.redirectUri',
      {
        infer: true,
      },
    );

    if (!server || !clientId || !clientSecret || !redirectUri) {
      throw new UnauthorizedException(
        'OAuth2 client is not configured. Check OAUTH2_SERVER, OAUTH2_CLIENT_ID, OAUTH2_CLIENT_SECRET, OAUTH2_REDIRECT_URI.',
      );
    }

    return new FlowAuthClient({
      server,
      clientId,
      clientSecret,
      redirectUri,
      autoRefresh: false,
    });
  }

  private getStateCacheKey(state: string): string {
    return `oauth2:state:${state}`;
  }

  private extractString(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    return undefined;
  }

  private normalizeAvatarUrl(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return undefined;
      }

      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown error';
  }
}
