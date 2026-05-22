import { All, Controller } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('api/:namespace/:version')
export class GatewayController {
  // Actual forwarding is handled by GatewayProxyMiddleware.
  @All('*path')
  passthrough(): void {
    return;
  }
}
