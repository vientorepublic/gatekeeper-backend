import { All, Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('gateway/:namespace/:version')
@UseGuards(JwtAuthGuard)
export class GatewayController {
  // Actual forwarding is handled by GatewayProxyMiddleware.
  @All('*path')
  passthrough(): void {
    return;
  }
}
