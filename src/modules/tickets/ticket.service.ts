import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import { ReserveTicketsDto } from './dto/ticket.dto';
import {
  QUEUE_NAMES,
  TICKET_RESERVATION_TIMEOUT_MINUTES,
} from '../../common/constants';
import { DateUtil } from '../../common/utils/date.util';

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.TICKET_RESERVATION) private readonly reservationQueue: Queue,
  ) {}

  /**
   * Reserve tickets with row-level locking and idempotency support.
   * Uses a Prisma transaction to atomically select and lock available tickets.
   */
  async reserveTickets(dto: ReserveTicketsDto) {
    // Idempotency: check if this reservation already exists
    if (dto.idempotencyKey) {
      const existing = await this.prisma.ticketReservation.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { tickets: true },
      });
      if (existing) {
        this.logger.log(`Idempotent reservation returned: ${existing.id}`);
        return existing;
      }
    }

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: dto.lotteryId, deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');
    if (!['PUBLISHED', 'SELLING'].includes(lottery.status)) {
      throw new BadRequestException('Lottery is not currently accepting ticket reservations');
    }
    if (DateUtil.isPast(lottery.saleEndDate)) {
      throw new BadRequestException('Ticket sale period has ended');
    }

    const expiresAt = DateUtil.addMinutes(new Date(), TICKET_RESERVATION_TIMEOUT_MINUTES);

    return this.prisma.$transaction(async (tx) => {
      let ticketIds: string[] = [];

      if (dto.ticketNumbers && dto.ticketNumbers.length > 0) {
        // Manual selection
        const tickets = await tx.lotteryTicket.findMany({
          where: {
            lotteryId: dto.lotteryId,
            ticketNumber: { in: dto.ticketNumbers },
            status: 'AVAILABLE',
          },
        });

        if (tickets.length !== dto.ticketNumbers.length) {
          throw new ConflictException('One or more requested tickets are no longer available');
        }
        ticketIds = tickets.map((t) => t.id);
      } else {
        // Random selection using raw SQL with row-level locking
        const available = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM lottery_tickets
          WHERE "lotteryId" = ${dto.lotteryId}
            AND status = 'AVAILABLE'
          ORDER BY RANDOM()
          LIMIT ${dto.quantity}
          FOR UPDATE SKIP LOCKED
        `;

        if (available.length < dto.quantity) {
          throw new ConflictException(
            `Only ${available.length} tickets available, requested ${dto.quantity}`,
          );
        }
        ticketIds = available.map((t) => t.id);
      }

      // Create reservation
      const reservation = await tx.ticketReservation.create({
        data: {
          lotteryId: dto.lotteryId,
          clientId: lottery.clientId,
          buyerEmail: dto.buyerEmail || null,
          buyerName: dto.buyerName,
          buyerPhone: dto.buyerPhone,
          quantity: dto.quantity,
          expiresAt,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      // Mark tickets as reserved
      await tx.lotteryTicket.updateMany({
        where: { id: { in: ticketIds } },
        data: { status: 'RESERVED', reservationId: reservation.id },
      });

      // Update lottery status to SELLING if first sale
      if (lottery.status === 'PUBLISHED') {
        await tx.lottery.update({
          where: { id: dto.lotteryId },
          data: { status: 'SELLING' },
        });
      }

      // Schedule expiration job
      await this.reservationQueue.add(
        'expire-reservation',
        { reservationId: reservation.id },
        { delay: TICKET_RESERVATION_TIMEOUT_MINUTES * 60 * 1000, jobId: `reservation:${reservation.id}` },
      );

      this.logger.log(`Reserved ${ticketIds.length} tickets for reservation ${reservation.id}`);

      return { ...reservation, ticketIds };
    });
  }

  async cancelReservation(reservationId: string): Promise<void> {
    const reservation = await this.prisma.ticketReservation.findUnique({
      where: { id: reservationId },
      include: { tickets: true },
    });
    if (!reservation) return;
    if (reservation.cancelledAt || reservation.confirmedAt) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.lotteryTicket.updateMany({
        where: { reservationId },
        data: { status: 'AVAILABLE', reservationId: null },
      });
      await tx.ticketReservation.update({
        where: { id: reservationId },
        data: { cancelledAt: new Date() },
      });
    });

    this.logger.log(`Reservation ${reservationId} cancelled`);
  }

  async expireReservation(reservationId: string): Promise<void> {
    const reservation = await this.prisma.ticketReservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation || reservation.confirmedAt || reservation.cancelledAt) return;
    if (DateUtil.isFuture(reservation.expiresAt)) return;

    await this.cancelReservation(reservationId);
    this.logger.log(`Reservation ${reservationId} expired`);
  }

  async confirmReservation(reservationId: string, paymentId: string): Promise<void> {
    const reservation = await this.prisma.ticketReservation.findUnique({
      where: { id: reservationId },
      include: { tickets: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.cancelledAt) throw new BadRequestException('Reservation has been cancelled');
    if (DateUtil.isPast(reservation.expiresAt)) {
      await this.cancelReservation(reservationId);
      throw new BadRequestException('Reservation has expired');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lotteryTicket.updateMany({
        where: { reservationId },
        data: { status: 'PENDING_PAYMENT', paymentId },
      });
      await tx.ticketReservation.update({
        where: { id: reservationId },
        data: { confirmedAt: new Date() },
      });
    });
  }

  async finalizeTickets(paymentId: string): Promise<void> {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { tickets: true },
    });
    if (!payment) return;

    const buyerId = payment.buyerId;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.lotteryTicket.updateMany({
        where: { paymentId },
        data: { status: 'SOLD', assignedAt: now, buyerId },
      });

      // Increment lottery ticketsSold count
      if (payment.lotteryId) {
        await tx.lottery.update({
          where: { id: payment.lotteryId },
          data: { ticketsSold: { increment: payment.tickets.length } },
        });
      }
    });

    this.logger.log(`Finalized ${payment.tickets.length} tickets for payment ${paymentId}`);
  }

  // ==================== QUERIES ====================

  async getLotteryTickets(lotteryId: string, clientId: string, query: PaginationDto & { status?: string }) {
    const { page = 1, limit = 20, status } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    // Ensure client owns lottery
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, clientId, deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const where = { lotteryId, ...(status && { status: status as 'AVAILABLE' }) };
    const [data, total] = await Promise.all([
      this.prisma.lotteryTicket.findMany({
        where, skip, take,
        include: { buyer: { select: { id: true, name: true, email: true } } },
        orderBy: { ticketNumber: 'asc' },
      }),
      this.prisma.lotteryTicket.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getBuyerTickets(buyerId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const where = { buyerId, status: 'SOLD' as const };
    const [data, total] = await Promise.all([
      this.prisma.lotteryTicket.findMany({
        where, skip, take,
        include: { lottery: { select: { id: true, name: true, slug: true, drawDate: true, status: true } } },
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.lotteryTicket.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.lotteryTicket.findUnique({
      where: { id },
      include: {
        lottery: { select: { id: true, name: true, slug: true, drawDate: true } },
        buyer: { select: { id: true, name: true, email: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /**
   * Returns the list of available ticket numbers for a lottery.
   * Used by the public picker UI so buyers can choose specific numbers.
   * Returns at most `limit` numbers (default 500) sorted numerically.
   */
  async getAvailableTicketNumbers(lotteryId: string, limit = 500): Promise<string[]> {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { lotteryId, status: 'AVAILABLE' },
      select: { ticketNumber: true },
      orderBy: { ticketNumber: 'asc' },
      take: limit,
    });

    return tickets.map((t) => t.ticketNumber);
  }
}
