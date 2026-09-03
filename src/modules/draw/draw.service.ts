import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';

@Injectable()
export class DrawService {
  private readonly logger = new Logger(DrawService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute a transparent, auditable, reproducible winner draw.
   * - Immutable: once drawn, results cannot be changed
   * - Auditable: draw hash + seed stored for verification
   * - No duplicates: each winner is unique across prizes
   */
  async executeDraw(lotteryId: string, clientId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, clientId, deletedAt: null },
      include: { prizes: { where: { status: 'ACTIVE' }, orderBy: { rank: 'asc' } } },
    });

    if (!lottery) throw new NotFoundException('Lottery not found');
    if (lottery.status !== 'CLOSED') {
      throw new BadRequestException('Lottery must be closed before drawing winners');
    }
    if (lottery.prizes.length === 0) {
      throw new BadRequestException('No prizes configured for this lottery');
    }

    // Check for existing draw
    const existingDraw = await this.prisma.lotteryDraw.findFirst({ where: { lotteryId } });
    if (existingDraw) {
      throw new BadRequestException('Draw has already been executed for this lottery');
    }

    // Get all sold tickets
    const soldTickets = await this.prisma.lotteryTicket.findMany({
      where: { lotteryId, status: 'SOLD' },
      include: { buyer: { select: { id: true, name: true, email: true } } },
    });

    if (soldTickets.length === 0) {
      throw new BadRequestException('No sold tickets found for this lottery');
    }

    const drawnAt = new Date();
    const seed = CryptoUtil.generateRandomToken(32);
    const hash = CryptoUtil.generateDrawHash(lotteryId, seed, drawnAt.toISOString());
    const rng = CryptoUtil.seededRandom(seed);

    // Shuffle tickets using Fisher-Yates with seeded RNG
    const shuffled = [...soldTickets];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return this.prisma.$transaction(async (tx) => {
      // Create draw record
      const draw = await tx.lotteryDraw.create({
        data: {
          lotteryId,
          drawMethod: 'RANDOM_SYSTEM',
          seed,
          hash,
          algorithm: 'SHA256_MERSENNE_TWISTER',
          drawnAt,
          metadata: {
            totalTickets: soldTickets.length,
            totalPrizes: lottery.prizes.length,
          },
        },
      });

      // Assign winners (one ticket per prize, no duplicates)
      const winners = [];
      const usedTicketIds = new Set<string>();
      let ticketIndex = 0;

      for (const prize of lottery.prizes) {
        const prizeWinners = [];

        for (let q = 0; q < prize.quantity; q++) {
          // Find next unused ticket
          while (ticketIndex < shuffled.length && usedTicketIds.has(shuffled[ticketIndex].id)) {
            ticketIndex++;
          }

          if (ticketIndex >= shuffled.length) {
            this.logger.warn(`Not enough tickets to fill all prizes for lottery ${lotteryId}`);
            break;
          }

          const winnerTicket = shuffled[ticketIndex];
          usedTicketIds.add(winnerTicket.id);
          ticketIndex++;

          const winner = await tx.lotteryWinner.create({
            data: {
              lotteryId,
              drawId: draw.id,
              prizeId: prize.id,
              ticketId: winnerTicket.id,
              buyerId: winnerTicket.buyerId,
              guestName: winnerTicket.buyer?.name,
              guestEmail: winnerTicket.buyer?.email,
            },
          });
          prizeWinners.push({ ...winner, ticket: winnerTicket, prize });
        }

        winners.push(...prizeWinners);
      }

      // Advance lottery status
      await tx.lottery.update({
        where: { id: lotteryId },
        data: { status: 'DRAWING', drawHash: hash, drawSeed: seed, drawnAt },
      });

      this.logger.log(
        `Draw executed for lottery ${lotteryId}: ${winners.length} winners selected. Hash: ${hash}`,
      );

      return { draw, winners, metadata: { seed, hash, algorithm: 'SHA256_MERSENNE_TWISTER', drawnAt } };
    });
  }

  async publishResults(lotteryId: string, clientId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, clientId, deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');
    if (lottery.status !== 'DRAWING') {
      throw new BadRequestException('Draw must be executed before publishing results');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.lotteryWinner.updateMany({
        where: { lotteryId },
        data: { publishedAt: now },
      });
      await tx.lottery.update({
        where: { id: lotteryId },
        data: { status: 'COMPLETED' },
      });
    });

    this.logger.log(`Results published for lottery ${lotteryId}`);
    return { message: 'Results published successfully' };
  }

  async getDrawResults(lotteryId: string, clientId?: string) {
    const where = { id: lotteryId, ...(clientId && { clientId }), deletedAt: null };
    const lottery = await this.prisma.lottery.findFirst({ where });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const winners = await this.prisma.lotteryWinner.findMany({
      where: { lotteryId },
      include: {
        prize: true,
        ticket: { select: { ticketNumber: true } },
        // Mask buyer info for public display
      },
      orderBy: { prize: { rank: 'asc' } },
    });

    const draw = await this.prisma.lotteryDraw.findFirst({ where: { lotteryId } });

    return {
      lottery: { id: lottery.id, name: lottery.name, drawHash: lottery.drawHash, drawnAt: lottery.drawnAt },
      draw,
      winners: winners.map((w) => ({
        id: w.id,
        prize: { rank: w.prize.rank, title: w.prize.title, value: w.prize.prizeValue },
        ticketNumber: w.ticket.ticketNumber,
        // Mask PII for public: show only initials
        winner: w.publishedAt
          ? { name: this.maskName(w.guestName || ''), email: this.maskEmail(w.guestEmail || '') }
          : null,
        publishedAt: w.publishedAt,
      })),
    };
  }

  /**
   * Manually enter winners from a physical draw.
   * The operator draws tickets in public (hard circle numbered tickets),
   * then enters the winning ticket numbers here.
   */
  async manualDraw(
    lotteryId: string,
    clientId: string,
    entries: { prizeId: string; ticketNumber: string; winnerName: string }[],
  ) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, clientId, deletedAt: null },
      include: { prizes: { orderBy: { rank: 'asc' } } },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');
    if (!['CLOSED'].includes(lottery.status)) {
      throw new BadRequestException('Lottery must be closed before recording winners');
    }

    const existingDraw = await this.prisma.lotteryDraw.findFirst({ where: { lotteryId } });
    if (existingDraw) {
      throw new BadRequestException('Winners have already been recorded for this lottery');
    }

    const drawnAt = new Date();
    const seed = CryptoUtil.generateRandomToken(32);
    const hash = CryptoUtil.generateDrawHash(lotteryId, seed, drawnAt.toISOString());

    return this.prisma.$transaction(async (tx) => {
      const draw = await tx.lotteryDraw.create({
        data: {
          lotteryId,
          drawMethod: 'MANUAL',
          seed,
          hash,
          algorithm: 'MANUAL_ENTRY',
          drawnAt,
          metadata: { totalEntries: entries.length },
        },
      });

      const winners = [];
      for (const entry of entries) {
        // Validate the prize belongs to this lottery
        const prize = lottery.prizes.find(p => p.id === entry.prizeId);
        if (!prize) throw new BadRequestException(`Prize ${entry.prizeId} not found in this lottery`);

        // Find the ticket by number (may be SOLD or AVAILABLE for manual draws)
        const ticket = await tx.lotteryTicket.findFirst({
          where: { lotteryId, ticketNumber: entry.ticketNumber },
        });
        if (!ticket) {
          throw new BadRequestException(`Ticket number ${entry.ticketNumber} not found in this lottery`);
        }

        const winner = await tx.lotteryWinner.create({
          data: {
            lotteryId,
            drawId: draw.id,
            prizeId: prize.id,
            ticketId: ticket.id,
            buyerId: ticket.buyerId ?? undefined,
            guestName: entry.winnerName,
          },
        });
        winners.push({ ...winner, ticket, prize });
      }

      await tx.lottery.update({
        where: { id: lotteryId },
        data: { status: 'DRAWING', drawHash: hash, drawSeed: seed, drawnAt },
      });

      this.logger.log(`Manual draw recorded for lottery ${lotteryId}: ${winners.length} winners`);
      return { draw, winners };
    });
  }

  async verifyDraw(lotteryId: string) {
    const lottery = await this.prisma.lottery.findUnique({ where: { id: lotteryId } });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const draw = await this.prisma.lotteryDraw.findFirst({ where: { lotteryId } });
    if (!draw) throw new NotFoundException('No draw found for this lottery');

    // Recompute hash to verify integrity
    const expectedHash = CryptoUtil.generateDrawHash(
      lotteryId,
      draw.seed,
      draw.drawnAt.toISOString(),
    );

    return {
      verified: expectedHash === draw.hash,
      storedHash: draw.hash,
      computedHash: expectedHash,
      seed: draw.seed,
      algorithm: draw.algorithm,
      drawnAt: draw.drawnAt,
    };
  }

  private maskName(name: string): string {
    if (!name) return '***';
    const parts = name.split(' ');
    return parts.map((p) => p[0] + '***').join(' ');
  }

  private maskEmail(email: string): string {
    if (!email) return '***';
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }
}
