import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlowAuthClient } from 'flowauth-oauth2-client';
import { Oauth2Service } from './oauth2.service';

function createService(): Oauth2Service {
  return new Oauth2Service(
    new ConfigService({
      gateway: {
        oauth2: {
          server: 'https://auth.example',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          redirectUri: 'https://console.example/',
        },
      },
    }),
    { upsertOAuth2User: jest.fn() } as never,
    {} as never,
  );
}

describe('OAuth2 SDK response boundaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    null,
    { access_token: 42 },
    { access_token: 'token', expires_in: Infinity },
    { access_token: 'token', scope: ['openid'] },
  ])('rejects malformed token responses: %j', async (value) => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest
      .spyOn(FlowAuthClient.prototype, 'refreshToken')
      .mockResolvedValue(value as never);
    await expect(
      createService().refreshSessionFromRefreshToken('refresh'),
    ).rejects.toThrow(BadGatewayException);
  });

  it('rejects a non-object userinfo response', async () => {
    jest
      .spyOn(FlowAuthClient.prototype, 'getUserInfo')
      .mockResolvedValue([] as never);
    await expect(
      createService().createSessionFromAccessToken('token'),
    ).rejects.toThrow('Invalid OAuth2 userinfo');
  });

  it('preserves the cause without logging token-bearing SDK error messages', async () => {
    const cause = new Error('Request failed with refresh token secret-value');
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    jest
      .spyOn(FlowAuthClient.prototype, 'refreshToken')
      .mockRejectedValue(cause);
    await expect(
      createService().refreshSessionFromRefreshToken('refresh'),
    ).rejects.toMatchObject({ cause });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
  });
});
