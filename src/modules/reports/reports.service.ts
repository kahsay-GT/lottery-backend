import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { buildPaginatedResult, getPrismaSkipTake } from '../../common/interfaces/pagination.interface';
import { QUEUE_NAMES } from '../../common/constants';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.EXPORT) private readonly exportQueue: Queue,
  ) {}

  // ==================== CLIENT REPORTS ====================

  async getLotterySalesReport(lotteryId: string, clientId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, clientId, deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const [ticketStats, paymentStats, buyerCount] = await Promise.all([
      this.prisma.lotteryTicket.groupBy({
        by: ['status'],
        where: { lotteryId },
        _count: { id: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { lotteryId, status: 'APPROVED' },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.lotteryTicket.findMany({
        where: { lotteryId, status: 'SOLD' },
        select: { buyerId: true },
        distinct: ['buyerId'],
      }),
    ]);

    return {
      lottery: { id: lottery.id, name: lottery.name, status: lottery.status },
      tickets: ticketStats.reduce(
        (acc, s) => ({ ...acc, [s.status]: s._count.id }),
        {} as Record<string, number>,
      ),
      revenue: paymentStats._sum.amount || 0,
      approvedPayments: paymentStats._count.id,
      uniqueBuyers: buyerCount.length,
    };
  }

  async getLotteryTickets(lotteryId: string, clientId: string | null, query: PaginationDto & { search?: string }) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, ...(clientId && { clientId }), deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const where: Record<string, unknown> = { lotteryId };
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search } },
        { buyer: { name: { contains: search, mode: 'insensitive' as const } } },
        { buyer: { phone: { contains: search } } },
        { payment: { referenceCode: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lotteryTicket.findMany({
        where,
        skip, take,
        include: {
          buyer: { select: { id: true, name: true, email: true, phone: true } },
          payment: { select: { referenceCode: true, status: true, amount: true, approvedAt: true } },
        },
        orderBy: { ticketNumber: 'asc' },
      }),
      this.prisma.lotteryTicket.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getLotteryBuyers(lotteryId: string, clientId: string | null, query: PaginationDto & { search?: string }) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, ...(clientId && { clientId }), deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    // Get sold tickets and group by buyer
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: {
        lotteryId,
        status: 'SOLD',
        ...(search && {
          OR: [
            { buyer: { name: { contains: search, mode: 'insensitive' as const } } },
            { buyer: { phone: { contains: search } } },
            { buyer: { email: { contains: search, mode: 'insensitive' as const } } },
          ],
        }),
      },
      include: {
        buyer: { select: { id: true, name: true, email: true, phone: true, isGuest: true, status: true, createdAt: true, lastLoginAt: true } },
        payment: { select: { referenceCode: true, amount: true, status: true, approvedAt: true } },
      },
      orderBy: { purchasedAt: 'desc' },
    });

    // Group by buyer
    const buyerMap = new Map<string, typeof tickets[0]['buyer'] & { tickets: number; totalPaid: number; paymentRefs: string[] }>();
    for (const t of tickets) {
      if (!t.buyer) continue;
      const b = t.buyer;
      if (!buyerMap.has(b.id)) {
        buyerMap.set(b.id, { ...b, tickets: 0, totalPaid: 0, paymentRefs: [] });
      }
      const entry = buyerMap.get(b.id)!;
      entry.tickets += 1;
      if (t.payment?.status === 'APPROVED') {
        entry.totalPaid += Number(t.payment.amount ?? 0);
      }
      if (t.payment?.referenceCode) {
        entry.paymentRefs.push(t.payment.referenceCode);
      }
    }

    const buyers = Array.from(buyerMap.values());
    const total = buyers.length;
    const paginated = buyers.slice(skip, skip + take);

    return buildPaginatedResult(paginated, total, page, limit);
  }

  async getLotteryPayments(lotteryId: string, clientId: string | null, query: PaginationDto & { search?: string }) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, ...(clientId && { clientId }), deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const where: Record<string, unknown> = { lotteryId, ...(clientId && { clientId }) };
    if (search) {
      where.OR = [
        { referenceCode: { contains: search } },
        { buyer: { name: { contains: search, mode: 'insensitive' as const } } },
        { buyer: { phone: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: { lotteryId, ...(clientId && { clientId }) },
        skip, take,
        include: {
          buyer: { select: { id: true, name: true, email: true, phone: true } },
          tickets: { select: { ticketNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where: { lotteryId, ...(clientId && { clientId }) } }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getLotteryWinners(lotteryId: string, clientId: string | null, query: PaginationDto & { search?: string }) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId, ...(clientId && { clientId }), deletedAt: null },
    });
    if (!lottery) throw new NotFoundException('Lottery not found');

    const where: Record<string, unknown> = { lotteryId };
    if (search) {
      where.OR = [
        { ticket: { ticketNumber: { contains: search } } },
        { ticket: { buyer: { name: { contains: search, mode: 'insensitive' as const } } } },
        { ticket: { buyer: { phone: { contains: search } } } },
        { prize: { title: { contains: search, mode: 'insensitive' as const } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lotteryWinner.findMany({
        where,
        skip, take,
        include: {
          prize: true,
          ticket: {
            include: {
              buyer: { select: { id: true, name: true, email: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lotteryWinner.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getClientDashboard(clientId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      activeLotteries,
      totalRevenue,
      ticketsSold,
      pendingPayments,
      underReviewPayments,
      verifiedPayments,
      todayRevenue,
      buyerCount,
    ] = await Promise.all([
      this.prisma.lottery.count({ where: { clientId, status: { in: ['PUBLISHED', 'SELLING'] }, deletedAt: null } }),
      this.prisma.paymentTransaction.aggregate({ where: { clientId, status: 'APPROVED' }, _sum: { amount: true } }),
      this.prisma.lotteryTicket.count({ where: { clientId: undefined, lottery: { clientId }, status: 'SOLD' } }),
      this.prisma.paymentTransaction.count({ where: { clientId, status: 'SUBMITTED' } }),
      this.prisma.paymentTransaction.count({ where: { clientId, status: 'UNDER_REVIEW' } }),
      this.prisma.paymentTransaction.count({ where: { clientId, status: 'APPROVED' } }),
      this.prisma.paymentTransaction.aggregate({
        where: { clientId, status: 'APPROVED', approvedAt: { gte: today } },
        _sum: { amount: true },
      }),
      this.prisma.buyer.count({ where: { clientId, deletedAt: null } }),
    ]);

    return {
      activeLotteries,
      totalRevenue: totalRevenue._sum.amount || 0,
      ticketsSold,
      pendingPayments,
      underReviewPayments,
      verifiedPayments,
      todaySales: todayRevenue._sum.amount || 0,
      totalBuyers: buyerCount,
    };
  }

  async getBuyerReport(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      clientId,
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.buyer.findMany({
        where, skip, take,
        include: { _count: { select: { tickets: true, payments: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.buyer.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getBuyerTickets(clientId: string, buyerId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.lotteryTicket.findMany({
        where: { buyerId, lottery: { clientId } },
        skip, take,
        include: {
          lottery: { select: { id: true, name: true, slug: true, status: true, drawDate: true } },
        },
        orderBy: { purchasedAt: 'desc' },
      }),
      this.prisma.lotteryTicket.count({ where: { buyerId, lottery: { clientId } } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getBuyerPayments(clientId: string, buyerId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: { buyerId, clientId },
        skip, take,
        include: {
          lottery: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where: { buyerId, clientId } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  // ==================== ADMIN REPORTS ====================

  async getPlatformRevenue(period = 'monthly') {
    // Use Prisma ORM groupBy instead of raw SQL to avoid column-name issues
    const approved = await this.prisma.paymentTransaction.findMany({
      where: { status: 'APPROVED', approvedAt: { not: null } },
      select: { approvedAt: true, amount: true },
      orderBy: { approvedAt: 'desc' },
      take: 1000,
    });

    // Group in application code by month or day
    const grouped = new Map<string, { revenue: number; count: number }>();
    for (const row of approved) {
      if (!row.approvedAt) continue;
      const d = new Date(row.approvedAt);
      let key: string;
      if (period === 'daily') {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      }
      const existing = grouped.get(key) ?? { revenue: 0, count: 0 };
      existing.revenue += Number(row.amount);
      existing.count += 1;
      grouped.set(key, existing);
    }

    return Array.from(grouped.entries())
      .map(([period, data]) => ({ period, revenue: data.revenue, count: data.count }))
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 24);
  }

  async getSubscriptionMetrics() {
    const [active, expired, cancelled, total] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { status: 'EXPIRED' } }),
      this.prisma.subscription.count({ where: { status: 'CANCELLED' } }),
      this.prisma.subscription.count(),
    ]);

    const byPlan = await this.prisma.subscription.groupBy({
      by: ['planId', 'status'],
      _count: { id: true },
      where: { status: 'ACTIVE' },
    });

    return { active, expired, cancelled, total, byPlan };
  }

  // ==================== EXPORT ====================

  async requestExport(dto: {
    clientId?: string;
    lotteryId?: string;
    type: string;
    format: 'EXCEL' | 'CSV' | 'PDF';
    filters?: Record<string, unknown>;
  }) {
    const exportRecord = await this.prisma.export.create({
      data: {
        clientId: dto.clientId,
        lotteryId: dto.lotteryId,
        type: dto.type,
        format: dto.format,
        status: 'PENDING',
        filters: dto.filters ? JSON.parse(JSON.stringify(dto.filters)) : undefined,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    await this.exportQueue.add('generate-export', { exportId: exportRecord.id });
    return exportRecord;
  }

  async getExport(id: string) {
    return this.prisma.export.findUnique({ where: { id } });
  }

  async generateLotteryExcel(lotteryId: string): Promise<Buffer> {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
      include: {
        // ALL tickets — not just sold — ordered by ticket number
        tickets: {
          include: {
            buyer: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isGuest: true,
                status: true,
                createdAt: true,
                lastLoginAt: true,
              },
            },
            payment: {
              select: {
                referenceCode: true,
                status: true,
                amount: true,
                approvedAt: true,
              },
            },
          },
          orderBy: { ticketNumber: 'asc' },
        },
        prizes: { orderBy: { rank: 'asc' } },
        winners: {
          include: {
            prize: true,
            ticket: { select: { ticketNumber: true } },
          },
        },
      },
    });

    if (!lottery) throw new NotFoundException('Lottery not found');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lottery SaaS';
    workbook.created = new Date();

    // ── Helpers ───────────────────────────────────────────────────────────
    const ticketStart = (lottery as unknown as Record<string, unknown>).ticketStart as number ?? 1;
    const ticketEnd   = (lottery as unknown as Record<string, unknown>).ticketEnd   as number ?? ticketStart + lottery.totalTickets - 1;
    const allTickets  = lottery.tickets;
    const soldTickets = allTickets.filter(t => t.status === 'SOLD');
    const totalRev    = soldTickets.reduce((s) => s + Number(lottery.ticketPrice), 0);

    const styleHeader = (sheet: ExcelJS.Worksheet) => {
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
      sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      sheet.getRow(1).height = 20;
    };

    // ── Summary sheet ─────────────────────────────────────────────────────
    const summarySheet = workbook.addWorksheet('📋 Summary');
    summarySheet.columns = [
      { header: 'Field', key: 'field', width: 26 },
      { header: 'Value', key: 'value', width: 44 },
    ];
    styleHeader(summarySheet);
    [
      ['Lottery Name',      lottery.name],
      ['Status',            lottery.status],
      ['Ticket Range',      `${ticketStart} – ${ticketEnd}`],
      ['Total Tickets',     lottery.totalTickets],
      ['Tickets Sold',      soldTickets.length],
      ['Tickets Available', allTickets.filter(t => t.status === 'AVAILABLE').length],
      ['Tickets Pending',   allTickets.filter(t => t.status === 'PENDING_PAYMENT').length],
      ['Tickets Reserved',  allTickets.filter(t => t.status === 'RESERVED').length],
      ['Unique Buyers',     new Set(allTickets.filter(t => t.buyerId).map(t => t.buyerId)).size],
      ['Ticket Price',      String(lottery.ticketPrice)],
      ['Total Revenue',     totalRev.toFixed(2)],
      ['Sale Start',        lottery.saleStartDate.toISOString()],
      ['Sale End',          lottery.saleEndDate.toISOString()],
      ['Draw Date',         lottery.drawDate.toISOString()],
      ['Generated At',      new Date().toISOString()],
    ].forEach(([field, value]) => {
      const row = summarySheet.addRow({ field, value });
      row.getCell('field').font = { bold: true };
      row.getCell('value').alignment = { horizontal: 'left' };
    });

    // ── All Tickets sheet ─────────────────────────────────────────────────
    const ticketSheet = workbook.addWorksheet('🎫 All Tickets');
    ticketSheet.columns = [
      { header: 'Ticket Number',     key: 'ticketNumber',  width: 16 },
      { header: 'Status',            key: 'status',        width: 14 },
      { header: 'Buyer ID',          key: 'buyerId',       width: 36 },
      { header: 'Buyer Name',        key: 'buyerName',     width: 28 },
      { header: 'Buyer Email',       key: 'buyerEmail',    width: 32 },
      { header: 'Buyer Phone',       key: 'buyerPhone',    width: 18 },
      { header: 'Payment Reference', key: 'paymentRef',    width: 36 },
      { header: 'Payment Status',    key: 'paymentStatus', width: 16 },
      { header: 'Amount Paid',       key: 'amountPaid',    width: 14 },
      { header: 'Purchased At',      key: 'purchasedAt',   width: 22 },
      { header: 'Assigned At',       key: 'assignedAt',    width: 22 },
    ];
    styleHeader(ticketSheet);

    allTickets.forEach((t) => {
      const row = ticketSheet.addRow({
        ticketNumber:  t.ticketNumber,
        status:        t.status,
        buyerId:       t.buyer?.id      || '—',
        buyerName:     t.buyer?.name    || '—',
        buyerEmail:    t.buyer?.email   || '—',
        buyerPhone:    t.buyer?.phone   || '—',
        paymentRef:    t.payment?.referenceCode || '—',
        paymentStatus: t.payment?.status || '—',
        amountPaid:    t.payment ? Number(t.payment.amount).toFixed(2) : '—',
        purchasedAt:   t.purchasedAt?.toISOString() || '—',
        assignedAt:    t.assignedAt?.toISOString()  || '—',
      });

      row.getCell('ticketNumber').font = { bold: true };
      // Dim the buyer ID slightly so it's visible but not distracting
      if (t.buyer?.id) row.getCell('buyerId').font = { color: { argb: 'FF6B7280' }, size: 9 };
      row.height = 18;
    });

    // Freeze top row and auto-filter
    ticketSheet.views = [{ state: 'frozen', ySplit: 1 }];
    ticketSheet.autoFilter = { from: 'A1', to: 'K1' };

    // ── Buyers sheet ──────────────────────────────────────────────────────
    // Group all sold/pending tickets by buyer, collecting all their ticket numbers
    const buyerMap = new Map<string, {
      id: string
      name: string
      email: string
      phone: string
      isGuest: boolean
      status: string
      registeredAt: string
      lastLogin: string
      tickets: string[]
      ticketCount: number
      totalPaid: number
      paymentRefs: string[]
    }>();

    for (const t of allTickets) {
      if (!t.buyer) continue;
      const key = t.buyer.id;
      if (!buyerMap.has(key)) {
        buyerMap.set(key, {
          id:           t.buyer.id,
          name:         t.buyer.name,
          email:        t.buyer.email ?? '',
          phone:        t.buyer.phone ?? '—',
          isGuest:      t.buyer.isGuest,
          status:       t.buyer.status,
          registeredAt: t.buyer.createdAt?.toISOString() ?? '—',
          lastLogin:    t.buyer.lastLoginAt?.toISOString() ?? '—',
          tickets:      [],
          ticketCount:  0,
          totalPaid:    0,
          paymentRefs:  [],
        });
      }
      const entry = buyerMap.get(key)!;
      entry.tickets.push(t.ticketNumber);
      entry.ticketCount += 1;
      if (t.payment?.status === 'APPROVED') {
        entry.totalPaid += Number(t.payment.amount ?? 0);
      }
      if (t.payment?.referenceCode && !entry.paymentRefs.includes(t.payment.referenceCode)) {
        entry.paymentRefs.push(t.payment.referenceCode);
      }
    }

    const buyersSheet = workbook.addWorksheet('👥 Buyers');
    buyersSheet.columns = [
      { header: 'Buyer ID',           key: 'buyerId',      width: 36 },
      { header: 'Full Name',          key: 'name',         width: 30 },
      { header: 'Email',              key: 'email',        width: 34 },
      { header: 'Phone',              key: 'phone',        width: 18 },
      { header: 'Ticket Numbers',     key: 'tickets',      width: 44 },
      { header: 'Tickets Bought',     key: 'ticketCount',  width: 16 },
      { header: 'Total Paid (ETB)',   key: 'totalPaid',    width: 16 },
      { header: 'Payment Refs',       key: 'paymentRefs',  width: 40 },
      { header: 'Account Type',       key: 'accountType',  width: 14 },
      { header: 'Account Status',     key: 'status',       width: 16 },
      { header: 'Registered At',      key: 'registeredAt', width: 24 },
      { header: 'Last Login',         key: 'lastLogin',    width: 24 },
    ];
    styleHeader(buyersSheet);

    const buyers = Array.from(buyerMap.values()).sort((a, b) => b.ticketCount - a.ticketCount);

    buyers.forEach((b) => {
      const row = buyersSheet.addRow({
        buyerId:      b.id,
        name:         b.name,
        email:        b.email || '—',
        phone:        b.phone,
        tickets:      b.tickets.join(', '),
        ticketCount:  b.ticketCount,
        totalPaid:    b.totalPaid.toFixed(2),
        paymentRefs:  b.paymentRefs.join(', '),
        accountType:  b.isGuest ? 'Guest' : 'Registered',
        status:       b.status,
        registeredAt: b.registeredAt,
        lastLogin:    b.lastLogin,
      });

      // Buyer ID — dimmed, small font (it's a UUID reference, not primary reading)
      row.getCell('buyerId').font    = { color: { argb: 'FF6B7280' }, size: 9 };
      row.getCell('name').font       = { bold: true };
      // Ticket numbers — green so they stand out and match the Tickets sheet
      row.getCell('tickets').font    = { color: { argb: 'FF34D399' } };
      row.getCell('ticketCount').font = { bold: true };
      row.getCell('totalPaid').font   = { bold: true };
      row.getCell('totalPaid').numFmt = '#,##0.00';
      row.height = 18;
    });

    buyersSheet.views = [{ state: 'frozen', ySplit: 1 }];
    buyersSheet.autoFilter = { from: 'A1', to: 'L1' };

    // ── Winners sheet ─────────────────────────────────────────────────────
    if (lottery.winners.length > 0) {
      const winnersSheet = workbook.addWorksheet('🏆 Winners');
      winnersSheet.columns = [
        { header: 'Prize Rank',    key: 'rank',         width: 12 },
        { header: 'Prize Title',   key: 'prize',        width: 28 },
        { header: 'Prize Value',   key: 'prizeValue',   width: 14 },
        { header: 'Ticket Number', key: 'ticketNumber', width: 16 },
      ];
      styleHeader(winnersSheet);
      lottery.winners.forEach((w, i) => {
        const row = winnersSheet.addRow({
          rank:         w.prize.rank,
          prize:        w.prize.title,
          prizeValue:   w.prize.prizeValue,
          ticketNumber: w.ticket.ticketNumber,
        });
        row.getCell('rank').font        = { bold: true };
        row.getCell('prizeValue').font  = { bold: true };
        row.getCell('ticketNumber').font = { bold: true };
        row.height = 18;
      });
      winnersSheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    // ── Prizes sheet ──────────────────────────────────────────────────────
    if (lottery.prizes.length > 0) {
      const prizesSheet = workbook.addWorksheet('🎁 Prizes');
      prizesSheet.columns = [
        { header: 'Rank',        key: 'rank',        width: 8  },
        { header: 'Title',       key: 'title',       width: 28 },
        { header: 'Description', key: 'description', width: 36 },
        { header: 'Value',       key: 'prizeValue',  width: 14 },
        { header: 'Quantity',    key: 'quantity',    width: 10 },
      ];
      styleHeader(prizesSheet);
      lottery.prizes.forEach((p) => {
        const row = prizesSheet.addRow({
          rank: p.rank, title: p.title, description: p.description ?? '',
          prizeValue: p.prizeValue, quantity: p.quantity,
        });
        row.getCell('prizeValue').font = { bold: true };
        row.height = 18;
      });
      prizesSheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
