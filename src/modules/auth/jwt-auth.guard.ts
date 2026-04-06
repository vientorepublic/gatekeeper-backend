import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { ApiKeysService } from './api-keys.service';
import { IdentityService } from './identity.service';
import type { JwtClaims } from '../../common/types/gateway.types';

function isJwtClaims(value: unknown): value is JwtClaims {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly identityService: IdentityService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      params?: Record<string, string | undefined>;
      user?: unknown;
    }>();

    const namespace = request.params?.namespace;
    const version = request.params?.version;
    const isGatewayProxyRequest =
      typeof namespace === 'string' &&
      namespace.length > 0 &&
      typeof version === 'string' &&
      version.length > 0;

    if (isGatewayProxyRequest) {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedException(
          'Missing bearer token. Use Bearer API key for use REST API requests.',
        );
      }

      const rawApiKey = authHeader.replace('Bearer ', '').trim();
      if (!rawApiKey) {
        throw new UnauthorizedException('Bearer token is empty');
      }

      const apiKeyUser = await this.apiKeysService.authenticateApiKey(
        rawApiKey,
        namespace,
      );

      request.user = {
        userId: apiKeyUser.id,
        subject: apiKeyUser.subject,
        provider: apiKeyUser.provider,
        scopes: [],
        email: apiKeyUser.email,
      };

      return true;
    }

    const apiKey = request.headers['x-api-key'];
    if (apiKey && apiKey.length > 0) {
      const apiKeyUser = await this.apiKeysService.authenticateApiKey(
        apiKey,
        namespace,
      );
      request.user = {
        userId: apiKeyUser.id,
        subject: apiKeyUser.subject,
        provider: apiKeyUser.provider,
        scopes: [],
        email: apiKeyUser.email,
      };
      return true;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token or x-api-key');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const jwtSecret = this.configService.get<string>('gateway.jwtSecret', {
      infer: true,
    });

    if (!jwtSecret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }

    try {
      const decoded = verify(token, jwtSecret, {
        algorithms: ['HS256'],
      });
      const claims = isJwtClaims(decoded) ? decoded : {};
      request.user = this.identityService.toIdentity(claims);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
