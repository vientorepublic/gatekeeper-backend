import { Controller, Get } from '@nestjs/common';
import type { HealthCheckResponseDto } from './dto/health.dto';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthCheckResponseDto {
    return { status: 'ok' };
  }
}
