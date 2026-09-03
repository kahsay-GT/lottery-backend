import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

// Custom IoAdapter that respects the same CORS config as HTTP
class SocketIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) return cb(null, true);
          const local =
            /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
              origin,
            );
          cb(null, local);
        },
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });
    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    bufferLogs: true,
  });

  // Attach custom Socket.io adapter before anything else
  app.useWebSocketAdapter(new SocketIoAdapter(app));

  const config = app.get(ConfigService);
  const reflector = app.get(Reflector);

  const port = config.get<number>('app.port') || 3000;
  const corsOrigins = config.get<string[]>('app.corsOrigins') || ['http://localhost:3001'];
  const nodeEnv = config.get<string>('app.nodeEnv') || 'development';

  // ==================== MIDDLEWARE ====================
  app.use(helmet({
    contentSecurityPolicy: nodeEnv === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  app.use(cookieParser());

  // ==================== CORS ====================
  // Allow localhost, configured origins, AND any local network IP (192.168.x.x, 10.x.x.x)
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      // Allow configured origins
      if (corsOrigins.includes(origin)) return callback(null, true);
      // Allow any local network / private IP range (mobile on same WiFi)
      const localNetwork = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);
      if (localNetwork) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Idempotency-Key'],
  });

  // ==================== GLOBAL PREFIX ====================
  app.setGlobalPrefix('api/v1');

  // ==================== VALIDATION ====================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,   // multipart routes (file uploads) send extra fields that would be rejected
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ==================== FILTERS & INTERCEPTORS ====================
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

  // ==================== SWAGGER ====================
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Lottery SaaS API')
      .setDescription('Enterprise Multi-Tenant Lottery SaaS Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Authentication')
      .addTag('Plans & Subscriptions')
      .addTag('Lotteries')
      .addTag('Tickets')
      .addTag('Payments')
      .addTag('Winner Draw')
      .addTag('Reports & Analytics')
      .addTag('Super Admin')
      .addServer(`http://localhost:${port}`)
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });
  }

  await app.listen(port);

  console.log(`
╔══════════════════════════════════════════════════════╗
║         Lottery SaaS Platform — Backend              ║
║  Environment : ${nodeEnv.padEnd(36)}║
║  Port        : ${String(port).padEnd(36)}║
║  API Base    : http://localhost:${port}/api/v1        ║
║  Swagger     : http://localhost:${port}/api/v1/docs   ║
╚══════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
