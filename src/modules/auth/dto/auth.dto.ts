import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsInt, Max, Min } from 'class-validator';

function trimToString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class OAuth2CallbackQueryDto {
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @Transform(({ value }) => trimToString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  state!: string;
}

export class OAuth2SessionRequestBodyDto {
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  accessToken!: string;

  @Transform(({ value }) => trimToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  scope?: string;
}

export class OAuth2RefreshRequestBodyDto {
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  refreshToken!: string;
}

export class ApiKeyRequestBodyDto {
  @Transform(({ value }) => trimToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;
}

export class ApiKeyListQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export interface OAuth2UserDto {
  id: string;
  provider: string;
  subject: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface NamespacesResponseDto {
  namespaces: string[];
}

export interface RouteGuideNamespaceDto {
  namespace: string;
  supportsAnyVersion: boolean;
  versions: string[];
}

export interface RouteGuideResponseDto {
  namespaces: RouteGuideNamespaceDto[];
}

export interface OAuth2AuthorizeResponseDto {
  authorizeUrl: string;
  state: string;
}

export interface OAuth2SessionResponseDto {
  accessToken: string;
  tokenType: 'Bearer';
  user: OAuth2UserDto;
}

export interface OAuth2RefreshResponseDto extends OAuth2SessionResponseDto {
  refreshToken: string | null;
  oauthAccessTokenExpiresIn: number | null;
}

export interface ApiKeyListItemDto {
  id: string;
  namespace: string;
  prefix: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeyListResponseDto {
  items: ApiKeyListItemDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ApiKeyIssueResponseDto {
  id: string;
  namespace: string;
  apiKey: string;
  prefix: string;
  createdAt: Date;
  label: string | null;
}

export interface ApiKeyRevokeResponseDto {
  revoked: boolean;
}
