export type NamespaceRouteMap = Record<string, string>;
export type RouteMapEntry = string | NamespaceRouteMap;
export type RouteMap = Record<string, RouteMapEntry>;

export interface ResolvedRoute {
  target: string;
  keepVersionPrefix: boolean;
}

export interface GatewayUserIdentity {
  userId?: string;
  subject: string;
  provider: string;
  scopes: string[];
  email?: string | null;
}

export interface JwtClaims {
  uid?: string;
  sub?: string;
  provider?: string;
  email?: string;
  scope?: string;
  [key: string]: unknown;
}
