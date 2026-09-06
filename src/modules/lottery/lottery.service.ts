import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { PlansService } from '../plans/plans.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import { CreateLotteryDto, CreatePrizeDto, UpdateLotteryDto } from './dto/lottery.dto';
import { generateSlug } from '../../common/utils/slug.util';
import { QUEUE_NAMES } from '../../common/constants';
import { FileService } from '../files/file.service';

function maskName(name: string): string {
  if (!name) return 'Winner';
  const parts = name.trim().split(' ');
  return parts.map(p => p.length <= 1 ? p : p[0] + '*'.repeat(Math.min(p.length - 1, 4))).join(' ');
}

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly fileService: FileService,
    @InjectQueue(QUEUE_NAMES.TICKET_RESERVATION) private readonly reservationQueue: Queue,
  ) {}

  // ==================== VALIDATION ====================

  private async validateSubscriptionForLottery(clientId: string, ticketPrice: number, totalTickets: number) {
    // Lottery creation requires an ACTIVE (approved) subscription only
    const sub = await this.prisma.subscription.findFirst({
      where: { clientId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      // Give a helpful message based on what subscription state they're actually in
      const pending = await this.prisma.subscription.findFirst({
        where: { clientId, status: { in: ['PENDING', 'AWAITING_PAYMENT', 'UNDER_REVIEW'] } },
      });
      if (pending) {
        throw new ForbiddenException(
          `Your subscription is ${pending.status.toLowerCase().replace('_', ' ')} — wait for admin approval before creating lotteries.`,
        );
      }
      throw new ForbiddenException('No active subscription found. Go to Subscription → choose a plan first.');
    }

    const plan = sub.plan;

    if (ticketPrice < Number(plan.minTicketPrice)) {
      throw new BadRequestException(`Ticket price below plan minimum of ${plan.minTicketPrice}`);
    }
    if (ticketPrice > Number(plan.maxTicketPrice)) {
      throw new BadRequestException(`Ticket price exceeds plan maximum of ${plan.maxTicketPrice}`);
    }
    if (totalTickets > plan.maxTicketsPerLottery) {
      throw new BadRequestException(`Total tickets exceeds plan maximum of ${plan.maxTicketsPerLottery}`);
    }

    const activeLotteries = await this.prisma.lottery.count({
      where: { clientId, status: { in: ['PUBLISHED', 'SELLING'] }, deletedAt: null },
    });
    if (activeLotteries >= plan.maxActiveLotteries) {
      throw new BadRequestException(`Active lottery limit reached (${plan.maxActiveLotteries})`);
    }

    if (sub.lotteriesUsed >= plan.maxLotteriesPerCycle) {
      throw new BadRequestException(`Lottery quota for this billing cycle exhausted`);
    }

    return sub;
  }

  // ==================== LOTTERY CRUD ====================

  async createLottery(clientId: string, dto: CreateLotteryDto) {
    const sub = await this.validateSubscriptionForLottery(clientId, dto.ticketPrice, dto.totalTickets);

    const slug = generateSlug(dto.name);

    // Resolve ticket range
    const ticketStart = dto.ticketStart ?? 1;
    const ticketEnd   = dto.ticketEnd   ?? ticketStart + dto.totalTickets - 1;

    // Validate: range width must match totalTickets
    if (ticketEnd - ticketStart + 1 !== dto.totalTickets) {
      throw new BadRequestException(
        `Ticket range ${ticketStart}–${ticketEnd} spans ${ticketEnd - ticketStart + 1} numbers but totalTickets is ${dto.totalTickets}`,
      );
    }

    const lottery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lottery.create({
        data: {
          clientId,
          subscriptionId: sub.id,
          name: dto.name,
          slug,
          description: dto.description,
          type: dto.type,
          ticketPrice: dto.ticketPrice,
          totalTickets: dto.totalTickets,
          ticketStart,
          ticketEnd,
          saleStartDate: new Date(dto.saleStartDate),
          saleEndDate: new Date(dto.saleEndDate),
          drawDate: new Date(dto.drawDate),
          visibility: dto.visibility,
          termsConditions: dto.termsConditions,
          status: 'DRAFT',
        },
      });

      // Pre-generate prizes
      if (dto.prizes && dto.prizes.length > 0) {
        await tx.lotteryPrize.createMany({
          data: dto.prizes.map((p) => ({ ...p, lotteryId: created.id, prizeValue: p.prizeValue })),
        });
      }

      // Pre-generate ticket numbers starting from ticketStart
      await this.preGenerateTickets(tx, created.id, clientId, dto.totalTickets, ticketStart);

      // Update subscription lottery count
      await tx.subscription.update({
        where: { id: sub.id },
        data: { lotteriesUsed: { increment: 1 } },
      });

      return created;
    });

    this.logger.log(`Lottery created: ${lottery.id} for client ${clientId} (tickets ${ticketStart}–${ticketEnd})`);
    return this.getLottery(lottery.id, clientId);
  }

  private async preGenerateTickets(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    lotteryId: string,
    clientId: string,
    total: number,
    ticketStart = 1,
  ) {
    const BATCH_SIZE = 1000;
    const batches = Math.ceil(total / BATCH_SIZE);
    // Determine how many digits to pad to based on the highest number
    const maxNum = ticketStart + total - 1;
    const padLen = Math.max(String(maxNum).length, 4); // at least 4 digits

    for (let b = 0; b < batches; b++) {
      const batchStart = ticketStart + b * BATCH_SIZE;
      const batchEnd   = Math.min(ticketStart + (b + 1) * BATCH_SIZE - 1, ticketStart + total - 1);
      const tickets = [];

      for (let i = batchStart; i <= batchEnd; i++) {
        tickets.push({
          lotteryId,
          clientId,
          ticketNumber: String(i).padStart(padLen, '0'),
          status: 'AVAILABLE' as const,
        });
      }

      await tx.lotteryTicket.createMany({ data: tickets });
    }
  }

  async listClientLotteries(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20, search, sortOrder = 'desc' } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      clientId,
      deletedAt: null,
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lottery.findMany({
        where, skip, take,
        orderBy: { createdAt: sortOrder },
        include: {
          prizes: { orderBy: { rank: 'asc' } },
          images: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { tickets: true, winners: true } },
        },
      }),
      this.prisma.lottery.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getLottery(id: string, clientId?: string) {
    const where = { id, deletedAt: null, ...(clientId && { clientId }) };
    const lottery = await this.prisma.lottery.findFirst({
      where,
      include: {
        prizes: { orderBy: { rank: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { tickets: true, winners: true } },
      },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');
    return lottery;
  }

  async updateLottery(id: string, clientId: string, dto: UpdateLotteryDto) {
    const lottery = await this.getLottery(id, clientId);
    if (!['DRAFT', 'PUBLISHED', 'SELLING'].includes(lottery.status)) {
      throw new BadRequestException('Only draft, published, or active lotteries can be edited');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { prizes: _prizes, ...rest } = dto;

    // Validate ticket range consistency if either range field is being updated
    const newStart = dto.ticketStart ?? lottery.ticketStart;
    const newTotal = dto.totalTickets ?? lottery.totalTickets;
    const newEnd   = dto.ticketEnd   ?? (newStart + newTotal - 1);
    if (dto.ticketStart !== undefined || dto.ticketEnd !== undefined || dto.totalTickets !== undefined) {
      if (newEnd - newStart + 1 !== newTotal) {
        throw new BadRequestException(
          `Ticket range ${newStart}–${newEnd} spans ${newEnd - newStart + 1} numbers but totalTickets is ${newTotal}`,
        );
      }
    }

    return this.prisma.lottery.update({
      where: { id },
      data: {
        ...rest,
        ticketEnd: newEnd,
        saleStartDate: dto.saleStartDate ? new Date(dto.saleStartDate) : undefined,
        saleEndDate: dto.saleEndDate ? new Date(dto.saleEndDate) : undefined,
        drawDate: dto.drawDate ? new Date(dto.drawDate) : undefined,
      },
    });
  }

  async publishLottery(id: string, clientId: string) {
    const lottery = await this.getLottery(id, clientId);
    if (lottery.status !== 'DRAFT') {
      throw new BadRequestException('Only draft lotteries can be published');
    }

    const prizes = await this.prisma.lotteryPrize.count({ where: { lotteryId: id } });
    if (prizes === 0) {
      throw new BadRequestException('Lottery must have at least one prize before publishing');
    }

    return this.prisma.lottery.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  async closeLottery(id: string, clientId: string) {
    const lottery = await this.getLottery(id, clientId);
    if (!['SELLING', 'PUBLISHED'].includes(lottery.status)) {
      throw new BadRequestException('Lottery cannot be closed in its current state');
    }
    return this.prisma.lottery.update({ where: { id }, data: { status: 'CLOSED' } });
  }

  async archiveLottery(id: string, clientId: string) {
    const lottery = await this.getLottery(id, clientId);
    if (lottery.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed lotteries can be archived');
    }
    return this.prisma.lottery.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async deleteLottery(id: string, clientId: string) {
    const lottery = await this.getLottery(id, clientId);
    if (lottery.status !== 'DRAFT') {
      throw new BadRequestException('Only draft lotteries can be deleted');
    }
    await this.prisma.lottery.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ==================== BANNER ====================

  async uploadBanner(id: string, clientId: string, file: Express.Multer.File): Promise<{ banner: string }> {
    // Verify ownership (no status restriction — banner can be updated any time)
    const lottery = await this.prisma.lottery.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const saved = await this.fileService.uploadFile(file, 'banners', clientId, 'client');
    const bannerUrl = `/api/v1/files/download/${saved.id}`;

    await this.prisma.lottery.update({
      where: { id },
      data: { banner: bannerUrl },
    });

    return { banner: bannerUrl };
  }

  // ==================== IMAGES ====================

  async addImage(id: string, clientId: string, file: Express.Multer.File): Promise<{ id: string; url: string; sortOrder: number }> {
    const lottery = await this.prisma.lottery.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const MAX_IMAGES = 10;
    const count = await this.prisma.lotteryImage.count({ where: { lotteryId: id } });
    if (count >= MAX_IMAGES) {
      throw new BadRequestException(`Maximum ${MAX_IMAGES} images allowed per lottery`);
    }

    const saved = await this.fileService.uploadFile(file, 'lottery-images', clientId, 'client');
    const url = `/api/v1/files/download/${saved.id}`;

    const image = await this.prisma.lotteryImage.create({
      data: {
        lotteryId: id,
        fileId: saved.id,
        url,
        sortOrder: count,
      },
    });

    return { id: image.id, url: image.url, sortOrder: image.sortOrder };
  }

  async deleteImage(id: string, imageId: string, clientId: string): Promise<void> {
    const lottery = await this.prisma.lottery.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const image = await this.prisma.lotteryImage.findFirst({
      where: { id: imageId, lotteryId: id },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.prisma.lotteryImage.delete({ where: { id: imageId } });
  }

  async reorderImages(id: string, clientId: string, orderedIds: string[]): Promise<void> {
    const lottery = await this.prisma.lottery.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    await this.prisma.$transaction(
      orderedIds.map((imgId, idx) =>
        this.prisma.lotteryImage.updateMany({
          where: { id: imgId, lotteryId: id },
          data: { sortOrder: idx },
        }),
      ),
    );
  }

  // ==================== PRIZES ====================

  async addPrize(lotteryId: string, clientId: string, dto: CreatePrizeDto) {
    await this.getLottery(lotteryId, clientId);
    return this.prisma.lotteryPrize.create({
      data: { ...dto, lotteryId, prizeValue: dto.prizeValue },
    });
  }

  async updatePrize(lotteryId: string, prizeId: string, clientId: string, dto: Partial<CreatePrizeDto>) {
    await this.getLottery(lotteryId, clientId);
    const prize = await this.prisma.lotteryPrize.findUnique({ where: { id: prizeId } });
    if (!prize || prize.lotteryId !== lotteryId) throw new NotFoundException('Prize not found');
    return this.prisma.lotteryPrize.update({ where: { id: prizeId }, data: dto });
  }

  async deletePrize(lotteryId: string, prizeId: string, clientId: string) {
    await this.getLottery(lotteryId, clientId);
    await this.prisma.lotteryPrize.delete({ where: { id: prizeId } });
  }

  // ==================== PUBLIC PORTAL ====================

  async listPublicLotteries(query: PaginationDto & { clientSlug?: string }) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      status: { in: ['PUBLISHED', 'SELLING'] as ('PUBLISHED' | 'SELLING')[] },
      visibility: 'PUBLIC' as const,
      deletedAt: null as null,
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lottery.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, businessName: true, logo: true, username: true } },
          prizes: { orderBy: { rank: 'asc' }, take: 3 },
          images: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { tickets: { where: { status: 'SOLD' } } } },
        },
      }),
      this.prisma.lottery.count({ where }),
    ]);

    const mappedData = data.map(({ _count, ...lot }) => ({
      ...lot,
      ticketsSold: _count.tickets,
    }));
    return buildPaginatedResult(mappedData, total, page, limit);
  }

  async getPublicLottery(slug: string) {
    const lottery = await this.prisma.lottery.findFirst({
      where: { slug, visibility: 'PUBLIC', deletedAt: null },
      include: {
        client: { select: { id: true, businessName: true, logo: true, username: true } },
        prizes: { orderBy: { rank: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { tickets: { where: { status: 'SOLD' } } } },
      },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');
    // Override ticketsSold with the live count from actual SOLD ticket rows
    const { _count, ...rest } = lottery;
    return { ...rest, ticketsSold: _count.tickets };
  }

  async getPublicLotteryByUsername(username: string, slug: string) {
    const client = await this.prisma.client.findUnique({
      where: { username, deletedAt: null },
    });
    if (!client) throw new NotFoundException('Operator not found');

    const lottery = await this.prisma.lottery.findFirst({
      where: { clientId: client.id, slug, visibility: 'PUBLIC', deletedAt: null },
      include: {
        client: { select: { id: true, businessName: true, logo: true, username: true } },
        prizes: { orderBy: { rank: 'asc' } },
        images: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { tickets: { where: { status: 'SOLD' } } } },
      },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    // Override ticketsSold with the live count from actual SOLD ticket rows
    const { _count, ...rest } = lottery;
    return { ...rest, ticketsSold: _count.tickets };
  }

  async listPublicLotteriesByUsername(username: string, query: PaginationDto) {
    const client = await this.prisma.client.findUnique({
      where: { username, deletedAt: null },
      select: { id: true, businessName: true, logo: true, username: true },
    });
    if (!client) throw new NotFoundException('Operator not found');

    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      clientId: client.id,
      status: { in: ['PUBLISHED', 'SELLING'] as ('PUBLISHED' | 'SELLING')[] },
      visibility: 'PUBLIC' as const,
      deletedAt: null as null,
    };

    const [data, total] = await Promise.all([
      this.prisma.lottery.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          prizes: { orderBy: { rank: 'asc' }, take: 3 },
          images: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { tickets: { where: { status: 'SOLD' } } } },
        },
      }),
      this.prisma.lottery.count({ where }),
    ]);

    const mappedData = data.map(({ _count, ...lot }) => ({
      ...lot,
      ticketsSold: _count.tickets,
    }));
    return { client, ...buildPaginatedResult(mappedData, total, page, limit) };
  }

  async listClosedLotteriesByUsername(username: string, query: PaginationDto) {
    const client = await this.prisma.client.findUnique({
      where: { username, deletedAt: null },
      select: { id: true, businessName: true, logo: true, username: true },
    });
    if (!client) throw new NotFoundException('Operator not found');

    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      clientId: client.id,
      status: { in: ['CLOSED', 'DRAWING', 'COMPLETED', 'ARCHIVED'] as ('CLOSED' | 'DRAWING' | 'COMPLETED' | 'ARCHIVED')[] },
      visibility: 'PUBLIC' as const,
      deletedAt: null as null,
    };

    const [data, total] = await Promise.all([
      this.prisma.lottery.findMany({
        where, skip, take,
        orderBy: { drawDate: 'desc' },
        include: {
          prizes: { orderBy: { rank: 'asc' }, take: 3 },
          _count: { select: { tickets: true, winners: true } },
        },
      }),
      this.prisma.lottery.count({ where }),
    ]);

    return { client, ...buildPaginatedResult(data, total, page, limit) };
  }

  async listWinnersByUsername(username: string, query: PaginationDto) {
    const client = await this.prisma.client.findUnique({
      where: { username, deletedAt: null },
      select: { id: true, businessName: true, logo: true, username: true },
    });
    if (!client) throw new NotFoundException('Operator not found');

    const { page = 1, limit = 30 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const [data, total] = await Promise.all([
      this.prisma.lotteryWinner.findMany({
        where: { lottery: { clientId: client.id, deletedAt: null } },
        skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          lottery: { select: { id: true, name: true, slug: true, drawDate: true } },
          prize:   { select: { rank: true, title: true, prizeValue: true } },
          ticket:  { select: { ticketNumber: true } },
        },
      }),
      this.prisma.lotteryWinner.count({
        where: { lottery: { clientId: client.id, deletedAt: null } },
      }),
    ]);

    // Mask winner names for privacy (use guestName or look up buyer name)
    const masked = await Promise.all(data.map(async (w) => {
      let buyerName: string | null = null;
      if (w.guestName) {
        buyerName = maskName(w.guestName);
      } else if (w.buyerId) {
        const buyer = await this.prisma.buyer.findUnique({
          where: { id: w.buyerId },
          select: { name: true },
        });
        buyerName = buyer ? maskName(buyer.name) : null;
      }
      return { ...w, buyerName };
    }));

    return { client, ...buildPaginatedResult(masked, total, page, limit) };
  }

  async getLotteryStats(id: string, clientId: string) {
    const lottery = await this.getLottery(id, clientId);
    const [available, reserved, pendingPayment, sold, cancelled] = await Promise.all([
      this.prisma.lotteryTicket.count({ where: { lotteryId: id, status: 'AVAILABLE' } }),
      this.prisma.lotteryTicket.count({ where: { lotteryId: id, status: 'RESERVED' } }),
      this.prisma.lotteryTicket.count({ where: { lotteryId: id, status: 'PENDING_PAYMENT' } }),
      this.prisma.lotteryTicket.count({ where: { lotteryId: id, status: 'SOLD' } }),
      this.prisma.lotteryTicket.count({ where: { lotteryId: id, status: 'CANCELLED' } }),
    ]);

    const revenue = await this.prisma.paymentTransaction.aggregate({
      where: { lotteryId: id, status: 'APPROVED' },
      _sum: { amount: true },
    });

    return {
      lottery: { id: lottery.id, name: lottery.name, status: lottery.status },
      tickets: { total: lottery.totalTickets, available, reserved, pendingPayment, sold, cancelled },
      revenue: revenue._sum.amount || 0,
    };
  }
}
