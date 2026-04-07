import {
  buildUpstreamHeaders,
  getProxyErrorCode,
  isResolvedRoute,
  readRequestBody,
} from './gateway-proxy.utils';
import { PayloadTooLargeException } from '@nestjs/common';

describe('gateway-proxy.utils', () => {
  describe('isResolvedRoute', () => {
    it('returns true for valid resolved route shape', () => {
      expect(
        isResolvedRoute({
          target: 'http://localhost:4001',
          keepVersionPrefix: true,
        }),
      ).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isResolvedRoute(null)).toBe(false);
      expect(isResolvedRoute({ target: 'http://localhost:4001' })).toBe(false);
      expect(isResolvedRoute({ target: 1, keepVersionPrefix: true })).toBe(
        false,
      );
    });
  });

  describe('readRequestBody', () => {
    it('returns undefined for GET requests', async () => {
      const req = {
        method: 'GET',
        *[Symbol.asyncIterator]() {
          yield Buffer.from('ignored');
        },
      };

      await expect(readRequestBody(req as never)).resolves.toBeUndefined();
    });

    it('concatenates body chunks for non-GET requests', async () => {
      const req = {
        method: 'POST',
        *[Symbol.asyncIterator]() {
          yield Buffer.from('hello');
          yield Buffer.from(' ');
          yield new Uint8Array(Buffer.from('world'));
        },
      };

      const body = await readRequestBody(req as never);
      expect(body?.toString('utf8')).toBe('hello world');
    });

    it('throws when request body exceeds configured size limit', async () => {
      const req = {
        method: 'POST',
        *[Symbol.asyncIterator]() {
          yield Buffer.from('hello');
          yield Buffer.from('world');
        },
      };

      await expect(readRequestBody(req as never, 8)).rejects.toThrow(
        PayloadTooLargeException,
      );
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
  });
});
