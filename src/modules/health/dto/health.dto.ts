export interface HealthCheckResponseDto {
  status: 'ok';
}

export interface HealthMetricsResponseDto {
  generatedAt: string;
  proxy: {
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
    inFlight: number;
    latencyMsAvg: number;
  };
  runtime: {
    memoryRssBytes: number;
    heapUsedBytes: number;
    eventLoopLagMsAvg: number;
  };
}
