import { RouteRegistryService } from './route-registry.service';
import type { RouteMap } from '../../common/types/gateway.types';

describe('RouteRegistryService', () => {
  const makeCache = () => {
    const store = new Map<string, unknown>();

    return {
      get: jest.fn(async <T>(key: string) => store.get(key) as T | undefined),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
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
    });
  });

  it('returns cached target when exists', async () => {
    const cache = {
      get: jest.fn(async () => ({
        target: 'http://cached.internal',
        keepVersionPrefix: true,
      })),
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
});
