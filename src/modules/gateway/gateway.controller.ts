import { All, Controller } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// All requests to this controller are intercepted and fully handled by
// GatewayProxyMiddleware before this handler is reached. Authentication is
// enforced there via assertGatewayAuthorization(). @UseGuards is intentionally
// absent here so it does not give a false impression of the security boundary.
@SkipThrottle()
@Controller('api/:namespace/:version')
export class GatewayController {
  // Actual forwarding is handled by GatewayProxyMiddleware.
  @All('*path')
  passthrough(): void {
    return;
  }
}
