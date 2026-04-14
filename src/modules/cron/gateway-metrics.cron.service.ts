import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GatewayMetricsService } from '../health/gateway-metrics.service';

@Injectable()
export class GatewayMetricsCronService {
  constructor(private readonly gatewayMetricsService: GatewayMetricsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  resetGatewayMetrics(): void {
    this.gatewayMetricsService.resetMetrics();
  }
}
