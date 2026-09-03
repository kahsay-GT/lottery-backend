import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TicketService } from '../../tickets/ticket.service';
import { QUEUE_NAMES } from '../../../common/constants';

@Processor(QUEUE_NAMES.TICKET_RESERVATION)
export class ReservationProcessor {
  private readonly logger = new Logger(ReservationProcessor.name);

  constructor(private readonly ticketService: TicketService) {}

  @Process('expire-reservation')
  async handleExpireReservation(job: Job<{ reservationId: string }>) {
    const { reservationId } = job.data;
    this.logger.debug(`Processing reservation expiry: ${reservationId}`);

    try {
      await this.ticketService.expireReservation(reservationId);
    } catch (error) {
      this.logger.error(`Failed to expire reservation ${reservationId}`, error);
      throw error;
    }
  }
}
