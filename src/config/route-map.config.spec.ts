import { describe, expect, it } from '@jest/globals';
import { normalizeRouteMap } from './route-map.config';

describe('route map validation', () => {
  it.each([[], null, 1, 'invalid'])(
    'rejects a non-object route map: %j',
    (value) => {
      expect(() => normalizeRouteMap(value)).toThrow('JSON object');
    },
  );

  it.each([[], [''], ['POST', 42], 'POST', null])(
    'rejects invalid public method allowlists: %j',
    (methods) => {
      expect(() =>
        normalizeRouteMap({
          app: {
            versions: { v1: 'https://upstream.example' },
            publicPaths: [{ path: '/health', methods }],
          },
        }),
      ).toThrow('methods');
    },
  );

  it('preserves method restrictions and normalizes case', () => {
    const map = normalizeRouteMap({
      app: {
        versions: { v1: 'https://upstream.example' },
        publicPaths: [{ path: '/health', methods: [' post '] }],
      },
    });
    expect(map.app).toMatchObject({
      publicPaths: [{ path: '/health', methods: ['POST'] }],
    });
  });

  it.each([{ path: '' }, { path: '  ' }, ''])(
    'rejects empty public paths: %j',
    (rule) => {
      expect(() =>
        normalizeRouteMap({ app: { versions: {}, publicPaths: [rule] } }),
      ).toThrow();
    },
  );

  it('rejects malformed public flags and path containers', () => {
    expect(() =>
      normalizeRouteMap({ app: { versions: {}, public: 'true' } }),
    ).toThrow('boolean');
    expect(() =>
      normalizeRouteMap({ app: { versions: {}, publicPaths: '/health' } }),
    ).toThrow('array');
  });

  it('retains prototype-like keys as own entries without changing object prototypes', () => {
    const input: unknown = JSON.parse(
      '{"__proto__":{"constructor":"https://upstream.example"}}',
    );
    const map = normalizeRouteMap(input);
    expect(Object.hasOwn(map, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(map['__proto__']).toEqual({
      constructor: 'https://upstream.example',
    });
  });
});
