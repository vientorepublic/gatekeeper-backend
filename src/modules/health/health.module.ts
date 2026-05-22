import { Module } from '@nestjs/common';
import { HealthMetricsModule } from './health-metrics.module';
import { HealthController } from './health.controller';

@Module({
  imports: [HealthMetricsModule],
  controllers: [HealthController],
})
export class HealthModule {}
