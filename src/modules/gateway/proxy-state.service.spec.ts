import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ProxyStateService } from './proxy-state.service';

describe('in-memory proxy state', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires circuit failures using the same TTL as Redis', async () => {
    jest.useFakeTimers();
    const service = new ProxyStateService(new ConfigService());
    const state = { consecutiveFailures: 1, openUntil: 0 };
    await service.setCircuitState('upstream', state, 100);
    expect(await service.getCircuitState('upstream')).toEqual(state);
    jest.advanceTimersByTime(100);
    expect(await service.getCircuitState('upstream')).toBeNull();
  });

  it('does not expose mutable references to stored circuit state', async () => {
    const service = new ProxyStateService(new ConfigService());
    const state = { consecutiveFailures: 1, openUntil: 0 };
    await service.setCircuitState('upstream', state, 1000);
    state.consecutiveFailures = 99;
    const cached = await service.getCircuitState('upstream');
    if (cached) cached.consecutiveFailures = 42;
    expect(await service.getCircuitState('upstream')).toEqual({
      consecutiveFailures: 1,
      openUntil: 0,
    });
  });
});
