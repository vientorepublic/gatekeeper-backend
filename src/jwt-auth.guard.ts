import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { IdentityService } from './identity.service';
import type { JwtClaims } from './gateway.types';

function isJwtClaims(value: unknown): value is JwtClaims {
  return typeof value === 'object' && value !== null;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function verifyHs256Jwt(token: string, secret: string): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = encodeBase64Url(
    createHmac('sha256', secret).update(signingInput).digest(),
  );

  const signatureBuffer = Buffer.from(encodedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid JWT signature');
  }

  const header = JSON.parse(decodeBase64Url(encodedHeader)) as {
    alg?: string;
  };
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported JWT algorithm');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as {
    exp?: number;
    [key: string]: unknown;
  };
  if (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000) {
    throw new Error('JWT expired');
  }

  return payload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly identityService: IdentityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const jwtSecret = this.configService.get<string>('gateway.jwtSecret', {
      infer: true,
    });

    if (!jwtSecret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }

    try {
      const decoded = verifyHs256Jwt(token, jwtSecret);
      const claims = isJwtClaims(decoded) ? decoded : {};
      request.user = this.identityService.toIdentity(claims);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
