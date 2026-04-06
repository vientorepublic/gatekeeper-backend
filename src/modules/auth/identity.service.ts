import { Injectable } from '@nestjs/common';
import type {
  GatewayUserIdentity,
  JwtClaims,
} from '../../common/types/gateway.types';

@Injectable()
export class IdentityService {
  toIdentity(claims: JwtClaims): GatewayUserIdentity {
    const scope = typeof claims.scope === 'string' ? claims.scope : '';

    return {
      userId: typeof claims.uid === 'string' ? claims.uid : undefined,
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown-user',
      provider:
        typeof claims.provider === 'string' ? claims.provider : 'oauth2',
      scopes: scope ? scope.split(' ') : [],
      email: typeof claims.email === 'string' ? claims.email : null,
    };
  }
}
