export type NamespaceRouteMap = Record<string, string>;
export type RouteMapEntry = string | NamespaceRouteMap;
export type RouteMap = Record<string, RouteMapEntry>;

export interface ResolvedRoute {
  target: string;
  keepVersionPrefix: boolean;
}

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
