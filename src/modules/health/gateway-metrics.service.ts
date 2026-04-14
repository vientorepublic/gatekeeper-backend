import { Injectable } from '@nestjs/common';

interface ProxyStatusCounts {
  total: number;
  upstream2xx: number;
  upstream3xx: number;
  upstream4xx: number;
  upstream5xx: number;
  gateway4xx: number;
  gateway5xx: number;
  timeouts: number;
  circuitOpenRejections: number;
  payloadTooLarge: number;
}

export interface GatewayMetricsSnapshot {
  generatedAt: string;
  proxy: ProxyStatusCounts & {
    inFlight: number;
    latencyMsAvg: number;
  };
  runtime: {
    memoryRssBytes: number;
    heapUsedBytes: number;
    eventLoopLagMsAvg: number;
  };
}

@Injectable()
export class GatewayMetricsService {
  // HTTP status code counts from upstream responses
  private readonly counts: ProxyStatusCounts = {
    total: 0,
    upstream2xx: 0,
    upstream3xx: 0,
    upstream4xx: 0,
    upstream5xx: 0,
    gateway4xx: 0,
    gateway5xx: 0,
    timeouts: 0,
    circuitOpenRejections: 0,
    payloadTooLarge: 0,
  };

  // Number of requests currently being processed
  private inFlight = 0;

  // Latency tracking for calculating average latency over time
  private latencyCount = 0;
  private latencySumMs = 0;

  private static readonly EMPTY_COUNTS: ProxyStatusCounts = {
    total: 0,
    upstream2xx: 0,
    upstream3xx: 0,
    upstream4xx: 0,
    upstream5xx: 0,
    gateway4xx: 0,
    gateway5xx: 0,
    timeouts: 0,
    circuitOpenRejections: 0,
    payloadTooLarge: 0,
  };

  // Sampler to track event loop lag over time
  private readonly lagSamplesMs: number[] = [];
  private readonly lagSampler = setInterval(() => {
    const expected = Date.now() + 1_000;
    setTimeout(() => {
      const lag = Math.max(0, Date.now() - expected);
      this.lagSamplesMs.push(lag);
      if (this.lagSamplesMs.length > 60) {
        this.lagSamplesMs.shift();
      }
    }, 1_000).unref();
  }, 1_000).unref();

  recordRequestStarted(): void {
    this.counts.total += 1;
    this.inFlight += 1;
  }

  recordRequestFinished(elapsedMs: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.latencyCount += 1;
    this.latencySumMs += Math.max(0, elapsedMs);
  }

  recordUpstreamStatus(status: number): void {
    if (status >= 200 && status < 300) {
      this.counts.upstream2xx += 1;
      return;
    }

    if (status >= 300 && status < 400) {
      this.counts.upstream3xx += 1;
      return;
    }

    if (status >= 400 && status < 500) {
      this.counts.upstream4xx += 1;
      return;
    }

    if (status >= 500) {
      this.counts.upstream5xx += 1;
    }
  }

  recordGatewayHttpStatus(status: number): void {
    if (status >= 400 && status < 500) {
      this.counts.gateway4xx += 1;
      return;
    }

    if (status >= 500) {
      this.counts.gateway5xx += 1;
    }
  }

  recordTimeout(): void {
    this.counts.timeouts += 1;
  }

  recordCircuitOpenRejection(): void {
    this.counts.circuitOpenRejections += 1;
  }

  recordPayloadTooLarge(): void {
    this.counts.payloadTooLarge += 1;
  }

  resetMetrics(): void {
    Object.assign(this.counts, GatewayMetricsService.EMPTY_COUNTS);
    this.latencyCount = 0;
    this.latencySumMs = 0;
  }

  getSnapshot(): GatewayMetricsSnapshot {
    const memoryUsage = process.memoryUsage();
    const lagAvg =
      this.lagSamplesMs.length === 0
        ? 0
        : Math.round(
            (this.lagSamplesMs.reduce((sum, item) => sum + item, 0) /
              this.lagSamplesMs.length) *
              100,
          ) / 100;

    return {
      generatedAt: new Date().toISOString(),
      proxy: {
        ...this.counts,
        inFlight: this.inFlight,
        latencyMsAvg:
          this.latencyCount === 0 ? 0 : this.latencySumMs / this.latencyCount,
      },
      runtime: {
        memoryRssBytes: memoryUsage.rss,
        heapUsedBytes: memoryUsage.heapUsed,
        eventLoopLagMsAvg: lagAvg,
      },
    };
  }

  onModuleDestroy(): void {
    clearInterval(this.lagSampler);
  }
}
