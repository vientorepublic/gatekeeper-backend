export type NamespaceRouteMap = Record<string, string>;

export interface PublicPathRule {
  /** Path pattern relative to the namespace root. Use `/*` suffix for prefix matching (e.g. `/docs/*`). */
  path: string;
  /** HTTP methods this rule applies to. If omitted, all methods are allowed. */
  methods?: string[];
}

export interface VersionedNamespaceRoute {
  versions: Record<string, string>;
  /** If true, all paths in this namespace are public. */
  public?: boolean;
  /** Specific paths that bypass bearer token validation. */
  publicPaths?: PublicPathRule[];
}

export type RouteMapEntry =
  | string
  | NamespaceRouteMap
  | VersionedNamespaceRoute;
export type RouteMap = Record<string, RouteMapEntry>;

export interface ResolvedRoute {
  target: string;
  keepVersionPrefix: boolean;
  /** True when the entire namespace is public. */
  isPublic: boolean;
  /** Path-level rules that bypass bearer token validation. */
  publicPaths: PublicPathRule[];
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
