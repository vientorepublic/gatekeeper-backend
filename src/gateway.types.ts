export type NamespaceRouteMap = Record<string, string>;
export type RouteMap = Record<string, NamespaceRouteMap>;

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
