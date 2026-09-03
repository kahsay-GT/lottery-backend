import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { QUEUE_NAMES } from '../../common/constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.TICKET_RESERVATION })],
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
