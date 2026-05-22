import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { createCorsMiddleware } from './common/middleware/cors.middleware';
import { preloadRouteMapFromUrl } from './config/route-map-loader';

async function bootstrap() {
  await preloadRouteMapFromUrl();

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  app.disable('x-powered-by');

  const configService = app.get(ConfigService);

  const jwtSecret = configService.get<string>('gateway.jwtSecret');
  if (jwtSecret === 'change-me-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_HMAC_SECRET must be changed from the default value in production. ' +
          'Set JWT_HMAC_SECRET to a cryptographically random secret of at least 32 bytes.',
      );
    }
    logger.warn(
      'JWT_HMAC_SECRET is set to the default insecure value. ' +
        'Set JWT_HMAC_SECRET to a strong random secret before deploying to production.',
    );
  }

  const corsOrigins = configService.get<string[]>('gateway.corsOrigins') ?? [
    'http://localhost:5173',
  ];

  app.use(createCorsMiddleware(corsOrigins));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`Gateway server started on port ${port}`);
}
void bootstrap();
