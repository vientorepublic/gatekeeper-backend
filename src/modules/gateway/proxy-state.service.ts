import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';

/**
 * Minimal subset of the @redis/client commands used for proxy state.
 * Defined as a structural interface so that the @redis/client union type
 * (RedisClientType | RedisClusterType | RedisSentinelType) satisfies it.
 */
interface RedisStateClient {
  readonly isOpen: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { PX?: number },
  ): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
}

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
  private readonly redis: RedisStateClient | null;

  // In-memory fallbacks (used when Redis is not configured)
  private readonly rateLimitMap = new Map<
    string,
    { count: number; windowStart: number }
  >();
  private readonly circuitMap = new Map<string, CircuitState>();

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('gateway.redisUrl');
    if (redisUrl) {
      const keyvRedis = new KeyvRedis(redisUrl);
      // @keyv/redis does not call connect() until the first Keyv operation;
      // cast to the minimal interface and connect explicitly in onModuleInit.
      this.redis = keyvRedis.client as unknown as RedisStateClient;
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
      await this.redis.disconnect();
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
      return value ? (JSON.parse(value) as CircuitState) : null;
    }

    return this.circuitMap.get(target) ?? null;
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

    this.circuitMap.set(target, state);
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
