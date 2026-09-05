import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

import { allConfigs } from './config/app.config';
import { PrismaModule } from './database/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { PlansModule } from './modules/plans/plans.module';
import { LotteryModule } from './modules/lottery/lottery.module';
import { TicketModule } from './modules/tickets/ticket.module';
import { PaymentModule } from './modules/payments/payment.module';
import { DrawModule } from './modules/draw/draw.module';
import { ReportsModule } from './modules/reports/reports.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HealthModule } from './modules/health/health.module';
import { ClientsModule } from './modules/clients/clients.module';
import { SlipVerifyModule } from './modules/slip-verify/slip-verify.module';
import { EventsModule } from './modules/events/events.module';
import { StaffModule } from './modules/staff/staff.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      load: allConfigs,
      envFilePath: ['.env'],
    }),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: (config.get<number>('throttle.ttl') || 60) * 1000,
        limit: config.get<number>('throttle.limit') || 100,
      }]),
    }),

    // Event Emitter
    EventEmitterModule.forRoot(),

    // BullMQ (Redis) — only loaded when REDIS_ENABLED=true
    ...(isRedisEnabled ? [BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host') || 'localhost',
          port: config.get<number>('redis.port') || 6379,
          password: config.get<string>('redis.password') || undefined,
          db: config.get<number>('redis.db') || 0,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      }),
    })] : []),

    // Core
    PrismaModule,
    AuditModule,
    FilesModule,
    NotificationModule,

    // Feature Modules
    AuthModule,
    AdminModule,
    PlansModule,
    LotteryModule,
    TicketModule,
    PaymentModule,
    DrawModule,
    ReportsModule,
    ...(isRedisEnabled ? [JobsModule] : []),
    HealthModule,
    ClientsModule,
    SlipVerifyModule,
    EventsModule,
    StaffModule,
  ],
  providers: [
    // Global exception filter
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global response wrapper
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },

    // Global guards
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
