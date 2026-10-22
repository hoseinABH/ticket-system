import * as path from 'path';

try {
  process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
} catch {
  try {
    process.loadEnvFile?.();
  } catch {}
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule, ObserveInstrument } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Flight Modular Monolith running on http://localhost:${port}`);
}
void bootstrap();
