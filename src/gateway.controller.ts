import { All, Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller(':namespace/:version')
@UseGuards(JwtAuthGuard)
export class GatewayController {
  // Actual forwarding is handled by GatewayProxyMiddleware.
  @All('*path')
  passthrough(): void {
    return;
  }
}
