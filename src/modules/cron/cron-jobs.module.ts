import { Module } from '@nestjs/common';
import { HealthMetricsModule } from '../health/health-metrics.module';
import { GatewayMetricsCronService } from './gateway-metrics.cron.service';

@Module({
  imports: [HealthMetricsModule],
  providers: [GatewayMetricsCronService],
})
export class CronJobsModule {}
