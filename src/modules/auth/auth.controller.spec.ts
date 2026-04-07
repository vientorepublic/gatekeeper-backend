import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ApiKeyRequestBodyDto,
  OAuth2CallbackQueryDto,
  OAuth2RefreshRequestBodyDto,
  OAuth2SessionRequestBodyDto,
} from './auth.controller';

describe('AuthController DTO validation', () => {
  it('requires non-empty OAuth2 callback code and state', () => {
    const dto = plainToInstance(OAuth2CallbackQueryDto, {
      code: '   ',
      state: 'state-123',
    });

    const errors = validateSync(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toContain('code');
  });

  it('accepts OAuth2 session body with trimmed values', () => {
    const dto = plainToInstance(OAuth2SessionRequestBodyDto, {
      accessToken: '  token-abc  ',
      scope: '  openid profile  ',
    });

    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.accessToken).toBe('token-abc');
    expect(dto.scope).toBe('openid profile');
  });

  it('requires non-empty refreshToken for OAuth2 refresh', () => {
    const dto = plainToInstance(OAuth2RefreshRequestBodyDto, {
      refreshToken: ' ',
    });

    const errors = validateSync(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toContain('refreshToken');
  });

  it('rejects api key label longer than 128 chars', () => {
    const dto = plainToInstance(ApiKeyRequestBodyDto, {
      label: 'a'.repeat(129),
    });

    const errors = validateSync(dto);
    const fields = errors.map((error) => error.property);

    expect(fields).toContain('label');
  });

  it('normalizes blank api key label to undefined', () => {
    const dto = plainToInstance(ApiKeyRequestBodyDto, {
      label: '   ',
    });

    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.label).toBeUndefined();
  });
});
