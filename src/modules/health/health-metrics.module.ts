import { Module } from '@nestjs/common';
import { GatewayMetricsService } from './gateway-metrics.service';

@Module({
  providers: [GatewayMetricsService],
  exports: [GatewayMetricsService],
})
export class HealthMetricsModule {}
