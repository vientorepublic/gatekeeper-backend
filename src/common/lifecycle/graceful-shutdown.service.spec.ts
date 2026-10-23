import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { GracefulShutdownService } from './graceful-shutdown.service';

describe('GracefulShutdownService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attempts every cache disconnect even if database and another store fail', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const destroy = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('database unavailable'));
    const failedStore = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('cache unavailable'));
    const healthyStore = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const service = new GracefulShutdownService(
      { isInitialized: true, destroy } as never,
      {
        stores: [{ disconnect: failedStore }, { disconnect: healthyStore }],
      } as never,
    );
    await expect(service.onApplicationShutdown()).rejects.toThrow(
      AggregateError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(failedStore).toHaveBeenCalledTimes(1);
    expect(healthyStore).toHaveBeenCalledTimes(1);
  });
});
