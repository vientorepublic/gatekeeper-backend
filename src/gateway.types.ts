export type RouteMap = Record<string, string>;

export interface GatewayUserIdentity {
  subject: string;
  provider: 'mock' | 'oauth2';
  scopes: string[];
}

export interface JwtClaims {
  sub?: string;
  scope?: string;
  [key: string]: unknown;
}
