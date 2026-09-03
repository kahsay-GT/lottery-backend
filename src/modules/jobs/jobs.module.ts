import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ReservationProcessor } from './processors/reservation.processor';
import { EmailProcessor } from './processors/email.processor';
import { SubscriptionProcessor } from './processors/subscription.processor';
import { ExportProcessor } from './processors/export.processor';
import { TicketModule } from '../tickets/ticket.module';
import { PlansModule } from '../plans/plans.module';
import { ReportsModule } from '../reports/reports.module';
import { QUEUE_NAMES } from '../../common/constants';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TICKET_RESERVATION },
      { name: QUEUE_NAMES.SUBSCRIPTION_EXPIRY },
      { name: QUEUE_NAMES.EMAIL },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.EXPORT },
    ),
    TicketModule,
    PlansModule,
    ReportsModule,
  ],
  providers: [
    ReservationProcessor,
    EmailProcessor,
    SubscriptionProcessor,
    ExportProcessor,
  ],
})
export class JobsModule {}
