import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { TicketModule } from '../tickets/ticket.module';
import { FilesModule } from '../files/files.module';
import { SlipVerifyModule } from '../slip-verify/slip-verify.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TicketModule, FilesModule, SlipVerifyModule, EventsModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
