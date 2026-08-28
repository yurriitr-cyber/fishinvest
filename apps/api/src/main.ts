import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { applySecurity, parseCorsOrigins } from './security/security';

function loadRootEnv() {
  const candidates = [
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../.env'),
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      // Do not override Railway/injected env — local .env only fills gaps
      loadEnv({ path: envPath, override: false });
      console.log(`Loaded env from ${envPath}`);
      return;
    }
  }
}

async function bootstrap() {
  loadRootEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, bodyLimit: 8 * 1024 * 1024 }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: true,
    }),
  );

  const origins = parseCorsOrigins();
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-admin-secret',
      'x-admin-session',
      'x-admin-telegram-id',
      'x-dev-telegram-id',
    ],
  });

  await applySecurity(app);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  console.log(
    `TELEGRAM_BOT_TOKEN: ${token && token !== 'your_bot_token_here' ? 'set' : 'MISSING'}`,
  );
  console.log(
    `CORS: ${origins === true ? 'reflect (dev)' : `allowlist (${origins.length})`}`,
  );

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://localhost:${port}/api`);
}

bootstrap();
