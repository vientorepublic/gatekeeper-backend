import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type {
  HealthCheckResponseDto,
  HealthMetricsResponseDto,
} from './dto/health.dto';
import { GatewayMetricsService } from './gateway-metrics.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly gatewayMetricsService: GatewayMetricsService) {}

  @Get()
  check(): HealthCheckResponseDto {
    return { status: 'ok' };
  }

  @Get('metrics')
  metrics(): HealthMetricsResponseDto {
    return this.gatewayMetricsService.getSnapshot();
  }
}
