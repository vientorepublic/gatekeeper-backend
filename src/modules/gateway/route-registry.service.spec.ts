import { describe, expect, it, jest } from '@jest/globals';
import { RouteRegistryService } from './route-registry.service';
import type { RouteMap } from '../../common/types/gateway.types';

describe('RouteRegistryService', () => {
  const makeCache = () => {
    const store = new Map<string, unknown>();

    return {
      get: jest.fn(<T>(key: string) =>
        Promise.resolve(store.get(key) as T | undefined),
      ),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    };
  };

  it('resolves versioned namespace with keepVersionPrefix=false', async () => {
    const cache = makeCache();
    const routeMap: RouteMap = {
      orders: {
        v1: 'http://orders-v1.internal',
      },
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'gateway.routeMap' ? routeMap : undefined,
      ),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('orders', 'v1')).resolves.toEqual({
      target: 'http://orders-v1.internal',
      keepVersionPrefix: false,
      isPublic: false,
      publicPaths: [],
    });
    expect(cache.set).toHaveBeenCalled();
  });

  it('resolves direct namespace with keepVersionPrefix=true', async () => {
    const cache = makeCache();
    const routeMap: RouteMap = {
      billing: 'http://billing.internal',
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'gateway.routeMap' ? routeMap : undefined,
      ),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('billing', 'v1')).resolves.toEqual({
      target: 'http://billing.internal',
      keepVersionPrefix: true,
      isPublic: false,
      publicPaths: [],
    });
  });

  it('returns cached target when exists', async () => {
    const cache = {
      get: jest.fn(() =>
        Promise.resolve({
          target: 'http://cached.internal',
          keepVersionPrefix: true,
        }),
      ),
      set: jest.fn(),
    };

    const configService = {
      get: jest.fn(),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('any', 'v1')).resolves.toEqual({
      target: 'http://cached.internal',
      keepVersionPrefix: true,
    });
    expect(configService.get).not.toHaveBeenCalled();
  });

  it('resolves VersionedNamespaceRoute with public=true and isPublic=true', async () => {
    const cache = makeCache();
    const routeMap: RouteMap = {
      openapi: { versions: { v1: 'http://openapi.internal' }, public: true },
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'gateway.routeMap' ? routeMap : undefined,
      ),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('openapi', 'v1')).resolves.toEqual({
      target: 'http://openapi.internal',
      keepVersionPrefix: false,
      isPublic: true,
      publicPaths: [],
    });
  });

  it('resolves VersionedNamespaceRoute without public flag as isPublic=false', async () => {
    const cache = makeCache();
    const routeMap: RouteMap = {
      internal: { versions: { v1: 'http://internal.service' } },
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'gateway.routeMap' ? routeMap : undefined,
      ),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('internal', 'v1')).resolves.toEqual({
      target: 'http://internal.service',
      keepVersionPrefix: false,
      isPublic: false,
      publicPaths: [],
    });
  });

  it('resolves VersionedNamespaceRoute with publicPaths', async () => {
    const cache = makeCache();
    const routeMap: RouteMap = {
      api: {
        versions: { v1: 'http://api.internal' },
        publicPaths: [
          { path: '/health' },
          { path: '/users/register', methods: ['POST'] },
        ],
      },
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'gateway.routeMap' ? routeMap : undefined,
      ),
    };

    const service = new RouteRegistryService(
      configService as never,
      cache as never,
    );

    await expect(service.getTarget('api', 'v1')).resolves.toEqual({
      target: 'http://api.internal',
      keepVersionPrefix: false,
      isPublic: false,
      publicPaths: [
        { path: '/health' },
        { path: '/users/register', methods: ['POST'] },
      ],
    });
  });
});
