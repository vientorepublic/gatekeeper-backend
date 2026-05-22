import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HealthMetricsModule } from '../health/health-metrics.module';
import { GatewayController } from './gateway.controller';
import { GatewayProxyMiddleware } from './gateway-proxy.middleware';
import { ProxyStateService } from './proxy-state.service';
import { RouteRegistryService } from './route-registry.service';

@Module({
  imports: [AuthModule, HealthMetricsModule],
  controllers: [GatewayController],
  providers: [RouteRegistryService, ProxyStateService, GatewayProxyMiddleware],
})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GatewayProxyMiddleware).forRoutes(GatewayController);
  }
}
