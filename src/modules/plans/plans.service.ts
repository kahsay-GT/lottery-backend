import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import {
  ApproveSubscriptionDto,
  CreateSubscriptionDto,
  RejectSubscriptionDto,
  SubmitPaymentSlipDto,
  UpgradeSubscriptionDto,
} from './dto/subscription.dto';
import { DateUtil } from '../../common/utils/date.util';
import { FileService } from '../files/file.service';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
  ) {}

  // ==================== PLANS (Admin) ====================

  async createPlan(dto: CreatePlanDto) {
    const slug = dto.name.toLowerCase().replace(/\s+/g, '-');
    return this.prisma.plan.create({
      data: { ...dto, slug, monthlyPrice: dto.monthlyPrice, yearlyPrice: dto.yearlyPrice,
               minTicketPrice: dto.minTicketPrice, maxTicketPrice: dto.maxTicketPrice },
    });
  }

  async listPlans(query: PaginationDto, publicOnly = false) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const where = { deletedAt: null, ...(publicOnly && { isActive: true }) };
    const [data, total] = await Promise.all([
      this.prisma.plan.findMany({ where, skip, take, orderBy: { sortOrder: 'asc' } }),
      this.prisma.plan.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getPlan(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id, deletedAt: null } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    await this.getPlan(id);
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  async deletePlan(id: string) {
    await this.getPlan(id);
    const activeSubscriptions = await this.prisma.subscription.count({
      where: { planId: id, status: 'ACTIVE' },
    });
    if (activeSubscriptions > 0) {
      throw new BadRequestException('Cannot delete plan with active subscriptions');
    }
    await this.prisma.plan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  // ==================== SUBSCRIPTIONS (Client) ====================

  async subscribe(clientId: string, dto: CreateSubscriptionDto) {
    const plan = await this.getPlan(dto.planId);

    // Check for existing active subscription
    const existing = await this.prisma.subscription.findFirst({
      where: { clientId, status: { in: ['ACTIVE', 'AWAITING_PAYMENT', 'UNDER_REVIEW', 'PENDING'] } },
    });
    if (existing) {
      throw new BadRequestException('Client already has a pending or active subscription');
    }

    const price = dto.billingCycle === 'MONTHLY' ? plan.monthlyPrice : plan.yearlyPrice;

    const subscription = await this.prisma.subscription.create({
      data: {
        clientId,
        planId: dto.planId,
        billingCycle: dto.billingCycle,
        price,
        status: 'PENDING',
      },
      include: { plan: true },
    });

    this.logger.log(`Client ${clientId} subscribed to plan ${dto.planId}`);
    return subscription;
  }

  async submitPaymentSlip(
    clientId: string,
    subscriptionId: string,
    file: Express.Multer.File,
    dto: SubmitPaymentSlipDto,
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.clientId !== clientId) throw new NotFoundException('Subscription not found');
    if (!['PENDING', 'AWAITING_PAYMENT'].includes(sub.status)) {
      throw new BadRequestException('Subscription is not awaiting payment');
    }

    // Upload the slip file
    const uploaded = await this.fileService.uploadFile(file, 'subscription-slips', clientId, 'client');

    // Create or reuse the transaction record
    let transaction = await this.prisma.subscriptionTransaction.findFirst({
      where: { subscriptionId, status: { in: ['INITIATED', 'SUBMITTED'] } },
    });

    if (!transaction) {
      transaction = await this.prisma.subscriptionTransaction.create({
        data: {
          subscriptionId,
          amount: sub.price,
          status: 'SUBMITTED',
          notes: dto.notes,
        },
      });
    } else {
      transaction = await this.prisma.subscriptionTransaction.update({
        where: { id: transaction.id },
        data: { status: 'SUBMITTED', notes: dto.notes },
      });
    }

    // Attach payment slip
    await this.prisma.paymentSlip.create({
      data: { subscriptionTransactionId: transaction.id, fileId: uploaded.id },
    });

    // Advance subscription to AWAITING_PAYMENT → UNDER_REVIEW
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'UNDER_REVIEW' },
    });

    this.logger.log(`Client ${clientId} submitted payment slip for subscription ${subscriptionId}`);
    return { message: 'Payment slip submitted. Your subscription is under review.', transactionId: transaction.id };
  }

  async getClientActiveSubscription(clientId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        clientId,
        status: { in: ['ACTIVE', 'PENDING', 'AWAITING_PAYMENT', 'UNDER_REVIEW'] },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClientSubscriptions(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { clientId }, skip, take,
        include: { plan: true, transactions: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscription.count({ where: { clientId } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async cancelSubscription(clientId: string, subscriptionId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.clientId !== clientId) throw new NotFoundException('Subscription not found');
    if (sub.status !== 'ACTIVE') throw new BadRequestException('Only active subscriptions can be cancelled');

    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async upgradeSubscription(clientId: string, subscriptionId: string, dto: UpgradeSubscriptionDto) {
    const current = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!current || current.clientId !== clientId) throw new NotFoundException('Subscription not found');
    if (current.status !== 'ACTIVE') throw new BadRequestException('Can only upgrade active subscriptions');

    const newPlan = await this.getPlan(dto.newPlanId);
    const price = dto.billingCycle === 'MONTHLY' ? newPlan.monthlyPrice : newPlan.yearlyPrice;

    // Cancel current, create new pending subscription
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    return this.prisma.subscription.create({
      data: { clientId, planId: dto.newPlanId, billingCycle: dto.billingCycle, price, status: 'PENDING' },
      include: { plan: true },
    });
  }

  // ==================== SUBSCRIPTIONS (Admin) ====================

  async listAllSubscriptionTransactions(query: PaginationDto) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const where = {
      ...(search && {
        OR: [
          { referenceCode: { contains: search, mode: 'insensitive' as const } },
          { subscription: { client: { name: { contains: search, mode: 'insensitive' as const } } } },
          { subscription: { client: { email: { contains: search, mode: 'insensitive' as const } } } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.subscriptionTransaction.findMany({
        where,
        skip,
        take,
        include: {
          subscription: {
            include: {
              client: { select: { id: true, name: true, email: true, businessName: true } },
              plan: { select: { id: true, name: true } },
            },
          },
          slips: { select: { id: true }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionTransaction.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async listAllSubscriptions(query: PaginationDto) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const where = {
      ...(search && {
        client: { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ]},
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where, skip, take,
        include: {
          client: { select: { id: true, name: true, email: true } },
          plan: true,
          transactions: {
            include: { slips: { select: { id: true }, take: 1 } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async approveSubscription(id: string, adminId: string, dto: ApproveSubscriptionDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { id }, include: { plan: true } });
    if (!sub) throw new NotFoundException('Subscription not found');

    const approvableStatuses = ['PENDING', 'AWAITING_PAYMENT', 'UNDER_REVIEW', 'ACTIVE'];
    if (!approvableStatuses.includes(sub.status)) {
      throw new BadRequestException(`Cannot approve subscription with status ${sub.status}`);
    }

    // For renewals on an already-active subscription, extend from current expiry
    const baseDate = sub.status === 'ACTIVE' && sub.expiresAt && sub.expiresAt > new Date()
      ? sub.expiresAt
      : new Date();
    const startsAt = sub.status === 'ACTIVE' ? (sub.startsAt ?? new Date()) : new Date();
    const expiresAt = sub.billingCycle === 'MONTHLY'
      ? DateUtil.addMonths(baseDate, 1)
      : DateUtil.addYears(baseDate, 1);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update the subscription
      const sub = await tx.subscription.update({
        where: { id },
        data: { status: 'ACTIVE', startsAt, expiresAt, approvedById: adminId, approvedAt: new Date(), notes: dto.notes },
        include: { plan: true, client: { select: { id: true, name: true, email: true } } },
      });

      // Mark the most recent pending transaction as APPROVED
      await tx.subscriptionTransaction.updateMany({
        where: { subscriptionId: id, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'INITIATED'] } },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      return sub;
    });

    this.logger.log(`Subscription ${id} approved by admin ${adminId}`);
    return updated;
  }

  async rejectSubscription(id: string, dto: RejectSubscriptionDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id },
        data: { status: 'CANCELLED', notes: dto.reason },
      });
      // Mark pending transactions as rejected
      await tx.subscriptionTransaction.updateMany({
        where: { subscriptionId: id, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'INITIATED'] } },
        data: { status: 'REJECTED', rejectionReason: dto.reason },
      });
      return updated;
    });
  }

  async getSubscription(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        client: { select: { id: true, name: true, email: true } },
        transactions: {
          include: {
            slips: { include: { file: true }, orderBy: { uploadedAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async getSlipPresignedUrl(subscriptionId: string): Promise<{ url: string; mimeType: string; fileName: string }> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        transactions: {
          include: {
            slips: { include: { file: true }, orderBy: { uploadedAt: 'desc' }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    const slip = sub.transactions?.[0]?.slips?.[0];
    if (!slip?.file) throw new NotFoundException('No payment slip found for this subscription');

    const url = await this.fileService.getPresignedUrl(slip.file.id); // download URL
    return { url, mimeType: slip.file.mimeType, fileName: slip.file.originalName };
  }

  // Called by background job to expire subscriptions
  async expireOverdueSubscriptions() {
    const expired = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    this.logger.log(`Expired ${expired.count} subscriptions`);
    return expired.count;
  }
}
