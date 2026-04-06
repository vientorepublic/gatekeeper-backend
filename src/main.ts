import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const origins = configService.get<string[]>('gateway.corsOrigins', {
    infer: true,
  });

  app.disable('x-powered-by');

  app.enableCors({
    origin: origins && origins.length > 0 ? origins : true,
    credentials: true,
  });

  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
