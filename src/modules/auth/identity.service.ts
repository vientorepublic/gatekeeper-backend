import { Injectable } from '@nestjs/common';
import type {
  GatewayUserIdentity,
  JwtClaims,
} from '../../common/types/gateway.types';

@Injectable()
export class IdentityService {
  // OAuth2 provider integration can replace this mock translator later.
  toIdentity(claims: JwtClaims): GatewayUserIdentity {
    const scope = typeof claims.scope === 'string' ? claims.scope : '';

    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'mock-user',
      provider: 'mock',
      scopes: scope ? scope.split(' ') : [],
    };
  }
}
