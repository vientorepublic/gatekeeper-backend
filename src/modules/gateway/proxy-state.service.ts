import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import { isRecord } from '../../common/utils/validation.utils';

interface CircuitState {
  consecutiveFailures: number;
  openUntil: number;
}

const KEY_PREFIX = 'gatekeeper:proxy';

/**
 * ProxyStateService manages rate-limit counters and circuit-breaker state.
 *
 * When REDIS_URL is configured, state is stored in Redis so that it is shared
 * across multiple gateway instances.  Rate-limit counters use the atomic INCR
 * + PEXPIRE pattern for fixed-window semantics.
 *
 * When Redis is not configured, state falls back to instance-level in-memory
 * Maps (suitable for single-instance deployments and tests).
 */
@Injectable()
export class ProxyStateService implements OnModuleInit, OnModuleDestroy {
  private readonly redis: KeyvRedis<unknown>['client'] | null;

  // In-memory fallbacks (used when Redis is not configured)
  private readonly rateLimitMap = new Map<
    string,
    { count: number; windowStart: number }
  >();
  private readonly circuitMap = new Map<
    string,
    { state: CircuitState; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('gateway.redisUrl');
    if (redisUrl) {
      const keyvRedis = new KeyvRedis(redisUrl);
      // Proxy counters use the native Redis client rather than the Keyv key-value API.
      this.redis = keyvRedis.client;
    } else {
      this.redis = null;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.redis && !this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) {
      await this.redis.close();
    }
  }

  /**
   * Atomically increments the rate-limit counter for a given client IP and
   * returns the new count.
   *
   * Redis: uses INCR (atomic) and sets PEXPIRE only on the first increment to
   * establish a fixed window without resetting the TTL on subsequent requests.
   *
   * In-memory: fixed-window counter with passive expiry on each new window.
   */
  async incrementRateLimit(
    clientIp: string,
    windowMs: number,
  ): Promise<number> {
    const key = `${KEY_PREFIX}:rl:${clientIp}`;

    if (this.redis) {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.pExpire(key, windowMs);
      }
      return count;
    }

    const now = Date.now();
    const state = this.rateLimitMap.get(clientIp);

    if (!state || now - state.windowStart >= windowMs) {
      // Purge expired entries to prevent unbounded memory growth under high IP cardinality
      if (this.rateLimitMap.size > 10_000) {
        for (const [k, entry] of this.rateLimitMap) {
          if (now - entry.windowStart >= windowMs) {
            this.rateLimitMap.delete(k);
          }
        }
      }
      this.rateLimitMap.set(clientIp, { count: 1, windowStart: now });
      return 1;
    }

    state.count += 1;
    return state.count;
  }

  async getCircuitState(target: string): Promise<CircuitState | null> {
    const key = `${KEY_PREFIX}:cb:${target}`;

    if (this.redis) {
      const value = await this.redis.get(key);
      if (!value) return null;
      const parsed: unknown = JSON.parse(value);
      if (
        !isRecord(parsed) ||
        typeof parsed.consecutiveFailures !== 'number' ||
        !Number.isSafeInteger(parsed.consecutiveFailures) ||
        parsed.consecutiveFailures < 0 ||
        typeof parsed.openUntil !== 'number' ||
        !Number.isFinite(parsed.openUntil) ||
        parsed.openUntil < 0
      ) {
        throw new Error('Invalid cached circuit state');
      }
      return {
        consecutiveFailures: parsed.consecutiveFailures,
        openUntil: parsed.openUntil,
      };
    }

    const cached = this.circuitMap.get(target);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.circuitMap.delete(target);
      return null;
    }
    return { ...cached.state };
  }

  async setCircuitState(
    target: string,
    state: CircuitState,
    ttlMs: number,
  ): Promise<void> {
    const key = `${KEY_PREFIX}:cb:${target}`;

    if (this.redis) {
      await this.redis.set(key, JSON.stringify(state), { PX: ttlMs });
      return;
    }

    this.circuitMap.set(target, {
      state: { ...state },
      expiresAt: Date.now() + ttlMs,
    });
  }

  async deleteCircuitState(target: string): Promise<void> {
    const key = `${KEY_PREFIX}:cb:${target}`;

    if (this.redis) {
      await this.redis.del(key);
      return;
    }

    this.circuitMap.delete(target);
  }
}
