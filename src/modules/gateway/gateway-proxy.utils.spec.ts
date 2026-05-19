import { describe, expect, it } from '@jest/globals';
import {
  buildUpstreamHeaders,
  getProxyErrorCode,
  isResolvedRoute,
  matchesPublicPath,
} from './gateway-proxy.utils';

describe('gateway-proxy.utils', () => {
  describe('isResolvedRoute', () => {
    it('returns true for valid resolved route shape', () => {
      expect(
        isResolvedRoute({
          target: 'http://localhost:4001',
          keepVersionPrefix: true,
          isPublic: false,
          publicPaths: [],
        }),
      ).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isResolvedRoute(null)).toBe(false);
      expect(isResolvedRoute({ target: 'http://localhost:4001' })).toBe(false);
      expect(
        isResolvedRoute({
          target: 'http://localhost:4001',
          keepVersionPrefix: true,
        }),
      ).toBe(false);
      expect(
        isResolvedRoute({
          target: 1,
          keepVersionPrefix: true,
          isPublic: false,
          publicPaths: [],
        }),
      ).toBe(false);
    });
  });

  describe('matchesPublicPath', () => {
    it('matches exact path', () => {
      expect(matchesPublicPath([{ path: '/health' }], '/health', 'GET')).toBe(
        true,
      );
    });

    it('matches exact path ignoring trailing slash', () => {
      expect(matchesPublicPath([{ path: '/health' }], '/health/', 'GET')).toBe(
        true,
      );
    });

    it('does not match different path', () => {
      expect(matchesPublicPath([{ path: '/health' }], '/status', 'GET')).toBe(
        false,
      );
    });

    it('matches wildcard prefix', () => {
      expect(
        matchesPublicPath([{ path: '/docs/*' }], '/docs/api.json', 'GET'),
      ).toBe(true);
      expect(matchesPublicPath([{ path: '/docs/*' }], '/docs/', 'GET')).toBe(
        true,
      );
      expect(matchesPublicPath([{ path: '/docs/*' }], '/docs', 'GET')).toBe(
        true,
      );
    });

    it('does not match path outside wildcard prefix', () => {
      expect(matchesPublicPath([{ path: '/docs/*' }], '/other', 'GET')).toBe(
        false,
      );
    });

    it('matches when method is in allowed list', () => {
      expect(
        matchesPublicPath(
          [{ path: '/users/register', methods: ['POST'] }],
          '/users/register',
          'POST',
        ),
      ).toBe(true);
    });

    it('does not match when method is not in allowed list', () => {
      expect(
        matchesPublicPath(
          [{ path: '/users/register', methods: ['POST'] }],
          '/users/register',
          'GET',
        ),
      ).toBe(false);
    });

    it('matches any method when methods array is omitted', () => {
      expect(matchesPublicPath([{ path: '/ping' }], '/ping', 'DELETE')).toBe(
        true,
      );
    });

    it('returns false for empty rules', () => {
      expect(matchesPublicPath([], '/health', 'GET')).toBe(false);
    });

    it('matches exact path without leading slash (middleware tailPath format)', () => {
      expect(matchesPublicPath([{ path: '/health' }], 'health', 'GET')).toBe(
        true,
      );
    });

    it('matches wildcard prefix without leading slash', () => {
      expect(
        matchesPublicPath([{ path: '/docs/*' }], 'docs/api.json', 'GET'),
      ).toBe(true);
    });

    it('matches method-restricted path without leading slash', () => {
      expect(
        matchesPublicPath(
          [{ path: '/users/register', methods: ['POST'] }],
          'users/register',
          'POST',
        ),
      ).toBe(true);
    });
  });

  describe('buildUpstreamHeaders', () => {
    it('copies headers and removes sensitive forwarding headers', () => {
      const req = {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer token',
          'x-api-key': 'gk_example',
          'content-length': '12',
          accept: ['application/json', 'text/plain'],
        },
      };

      const headers = buildUpstreamHeaders(
        req as never,
        'https://issuer.example',
      );

      expect(headers.get('host')).toBeNull();
      expect(headers.get('content-length')).toBeNull();
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('x-api-key')).toBeNull();
      expect(headers.get('accept')).toBe('application/json,text/plain');
      expect(headers.get('x-oauth2-issuer-hint')).toBe(
        'https://issuer.example',
      );
    });
  });

  describe('getProxyErrorCode', () => {
    it('returns custom code when error has string code', () => {
      expect(getProxyErrorCode({ code: 'ECONNRESET' })).toBe('ECONNRESET');
    });

    it('returns default code for unknown shape', () => {
      expect(getProxyErrorCode(new Error('boom'))).toBe('UPSTREAM_UNAVAILABLE');
      expect(getProxyErrorCode('boom')).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('returns timeout code for abort errors', () => {
      const error = new Error('timeout');
      error.name = 'AbortError';

      expect(getProxyErrorCode(error)).toBe('UPSTREAM_TIMEOUT');
    });
  });
});
