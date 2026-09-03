import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import {
  ClientStatusAction,
  CreateAdminDto,
  CreateBankAccountDto,
  SystemSettingDto,
  ToggleBankAccountStatusDto,
  UpdateBankAccountDto,
  UpdateClientStatusDto,
} from './dto/admin.dto';
import {
  AdminRole,
  CreateUserDto,
  ROLE_PERMISSIONS,
  UpdateUserDto,
} from './dto/user-management.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== CLIENTS ====================

  async listClients(query: PaginationDto) {
    const { page = 1, limit = 20, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where = {
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { businessName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          email: true,
          name: true,
          businessName: true,
          phone: true,
          status: true,
          createdAt: true,
          _count: { select: { lotteries: true, subscriptions: true } },
        },
      }),
      this.prisma.client.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getClient(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id, deletedAt: null },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        lotteries: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            name: true,
            status: true,
            ticketPrice: true,
            totalTickets: true,
            ticketsSold: true,
            saleStartDate: true,
            saleEndDate: true,
            drawDate: true,
            createdAt: true,
            _count: { select: { tickets: true, winners: true } },
          },
        },
        _count: {
          select: {
            lotteries: { where: { deletedAt: null } },
            buyers: true,
            subscriptions: true,
          },
        },
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    const { password: _, ...safeClient } = client;
    return safeClient;
  }

  async updateClientStatus(id: string, dto: UpdateClientStatusDto) {
    const client = await this.prisma.client.findUnique({ where: { id, deletedAt: null } });
    if (!client) throw new NotFoundException('Client not found');

    const newStatus = dto.action === ClientStatusAction.ACTIVATE ? 'ACTIVE' : 'SUSPENDED';
    const updated = await this.prisma.client.update({
      where: { id },
      data: { status: newStatus },
    });

    this.logger.log(`Client ${id} status changed to ${newStatus}`);
    return { id: updated.id, status: updated.status };
  }

  async toggleClientVerified(id: string, isVerified: boolean) {
    const client = await this.prisma.client.findUnique({ where: { id, deletedAt: null } });
    if (!client) throw new NotFoundException('Client not found');
    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
      },
      select: { id: true, isVerified: true, verifiedAt: true },
    });
    this.logger.log(`Client ${id} verified=${isVerified}`);
    return updated;
  }

  async deleteClient(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id, deletedAt: null } });

    await this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Client ${id} soft-deleted`);
  }

  // ==================== PLATFORM STATS ====================

  async getPlatformDashboard() {
    const [
      totalClients,
      activeClients,
      activeSubscriptions,
      activeLotteries,
      totalTicketsSold,
      subRevenueResult,
      lotteryRevenueResult,
    ] = await Promise.all([
      this.prisma.client.count({ where: { deletedAt: null } }),
      this.prisma.client.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.lottery.count({ where: { status: 'SELLING', deletedAt: null } }),
      this.prisma.lotteryTicket.count({ where: { status: 'SOLD' } }),
      // Revenue from operator subscription payments
      this.prisma.subscriptionTransaction.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
      }),
      // Revenue from lottery ticket payments (operators' lotteries)
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
      }),
    ]);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthlySubRevenue, monthlyLotteryRevenue] = await Promise.all([
      this.prisma.subscriptionTransaction.aggregate({
        where: { status: 'APPROVED', approvedAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'APPROVED', approvedAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const subRevenue = Number(subRevenueResult._sum.amount || 0);
    const lotteryRevenue = Number(lotteryRevenueResult._sum.amount || 0);

    return {
      totalClients,
      activeClients,
      activeSubscriptions,
      activeLotteries,
      totalTicketsSold,
      // Subscription revenue (admin earns this directly)
      subscriptionRevenue: subRevenue,
      monthlySubscriptionRevenue: Number(monthlySubRevenue._sum.amount || 0),
      // Lottery ticket revenue (operators' lottery sales)
      lotteryRevenue,
      monthlyLotteryRevenue: Number(monthlyLotteryRevenue._sum.amount || 0),
      // Combined totals
      totalRevenue: subRevenue + lotteryRevenue,
      monthlyRevenue: Number(monthlySubRevenue._sum.amount || 0) + Number(monthlyLotteryRevenue._sum.amount || 0),
    };
  }

  async getRevenueChart(period: 'daily' | 'monthly' = 'monthly') {
    // Use ORM instead of raw SQL to avoid camelCase/snake_case column issues
    const approved = await this.prisma.paymentTransaction.findMany({
      where: { status: 'APPROVED', approvedAt: { not: null } },
      select: { approvedAt: true, amount: true },
      orderBy: { approvedAt: 'desc' },
      take: 500,
    });

    const grouped = new Map<string, number>();
    for (const row of approved) {
      if (!row.approvedAt) continue;
      const d = new Date(row.approvedAt);
      const key = period === 'daily'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      grouped.set(key, (grouped.get(key) ?? 0) + Number(row.amount));
    }

    return Array.from(grouped.entries())
      .map(([period, revenue]) => ({ period, revenue }))
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 12);
  }

  // ==================== ADMINS ====================

  async createAdmin(dto: CreateAdminDto) {
    const existing = await this.prisma.admin.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('Admin email already exists');

    const hashed = await argon2.hash(dto.password);
    const admin = await this.prisma.admin.create({
      data: { email: dto.email, password: hashed, name: dto.name, phone: dto.phone, status: 'ACTIVE' },
    });
    const { password: _, ...safe } = admin;
    return safe;
  }

  async listAdmins(query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.admin.findMany({
        where: { deletedAt: null },
        skip, take,
        select: { id: true, email: true, name: true, status: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.admin.count({ where: { deletedAt: null } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  // ==================== SETTINGS ====================

  async getSettings() {
    return this.prisma.setting.findMany({ orderBy: { group: 'asc' } });
  }

  async getPublicSettings() {
    return this.prisma.setting.findMany({
      where: { isPublic: true },
      orderBy: { key: 'asc' },
    });
  }

  async upsertSetting(dto: SystemSettingDto) {
    return this.prisma.setting.upsert({
      where: { key: dto.key },
      update: { value: dto.value },
      create: { key: dto.key, value: dto.value },
    });
  }

  // ==================== ALL LOTTERIES VIEW ====================

  async listAllLotteries(query: PaginationDto) {
    const { page = 1, limit = 20, search, clientId } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
      ...(clientId && { clientId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lottery.findMany({
        where, skip, take,
        include: {
          client: { select: { id: true, businessName: true } },
          _count: { select: { tickets: true, winners: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lottery.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  // ==================== AUDIT LOGS ====================

  async getAuditLogs(query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, name: true, email: true } },
          client: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.auditLog.count(),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  // ==================== PLATFORM BANK ACCOUNTS ====================

  async listBankAccounts() {
    return this.prisma.bankAccount.findMany({
      where: { clientId: null },
      include: { bank: true },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getBankAccount(id: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
      include: { bank: true },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  async createBankAccount(dto: CreateBankAccountDto) {
    // Find or create the bank by name (case-insensitive)
    let bank = await this.prisma.bank.findFirst({
      where: { name: { equals: dto.bankName, mode: 'insensitive' } },
    });

    if (!bank) {
      bank = await this.prisma.bank.create({ data: { name: dto.bankName } });
    }

    return this.prisma.bankAccount.create({
      data: {
        bankId: bank.id,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        isActive: true,
      },
      include: { bank: true },
    });
  }

  async updateBankAccount(id: string, dto: UpdateBankAccountDto) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Bank account not found');

    let bankId = account.bankId;

    if (dto.bankName) {
      let bank = await this.prisma.bank.findFirst({
        where: { name: { equals: dto.bankName, mode: 'insensitive' } },
      });
      if (!bank) {
        bank = await this.prisma.bank.create({ data: { name: dto.bankName } });
      }
      bankId = bank.id;
    }

    return this.prisma.bankAccount.update({
      where: { id },
      data: {
        bankId,
        ...(dto.accountName && { accountName: dto.accountName }),
        ...(dto.accountNumber && { accountNumber: dto.accountNumber }),
      },
      include: { bank: true },
    });
  }

  async toggleBankAccountStatus(id: string, dto: ToggleBankAccountStatusDto) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Bank account not found');

    return this.prisma.bankAccount.update({
      where: { id },
      data: { isActive: dto.isActive },
      include: { bank: true },
    });
  }

  async deleteBankAccount(id: string) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Bank account not found');
    await this.prisma.bankAccount.delete({ where: { id } });
    return { deleted: true };
  }

  // ==================== USER MANAGEMENT ====================

  async createUser(dto: CreateUserDto, currentUserId: string) {
    const existing = await this.prisma.admin.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('User email already exists');

    const hashed = await argon2.hash(dto.password);
    const user = await this.prisma.admin.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        status: 'ACTIVE',
      },
    });

    // Log the creation
    await this.prisma.auditLog.create({
      data: {
        adminId: currentUserId,
        entityType: 'Admin',
        entityId: user.id,
        action: 'CREATE',
        newValue: { name: user.name, email: user.email, role: user.role },
      },
    });

    const { password: _, ...safe } = user;
    return safe;
  }

  async listUsers(query: PaginationDto) {
    const { page = 1, limit = 20, search, role, status } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ];
    }
    if (role) where.role = role;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        skip,
        take,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.admin.count({ where }),
    ]);

    // Add permissions to each user based on role
    const usersWithPermissions = data.map(user => ({
      ...user,
      permissions: ROLE_PERMISSIONS[user.role as AdminRole] || [],
    }));

    return buildPaginatedResult(usersWithPermissions, total, page, limit);
  }

  async getUser(id: string) {
    const user = await this.prisma.admin.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        emailVerifiedAt: true,
        failedLoginCount: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      ...user,
      permissions: ROLE_PERMISSIONS[user.role as AdminRole] || [],
    };
  }

  async updateUser(id: string, dto: UpdateUserDto, currentUserId: string) {
    const user = await this.prisma.admin.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    const updateData: Record<string, unknown> = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.phone) updateData.phone = dto.phone;
    if (dto.role) updateData.role = dto.role;
    if (dto.password) updateData.password = await argon2.hash(dto.password);

    const updated = await this.prisma.admin.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, name: true, phone: true, role: true, status: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId: currentUserId,
        entityType: 'Admin',
        entityId: id,
        action: 'UPDATE',
        oldValue: { name: user.name, role: user.role },
        newValue: { name: updated.name, role: updated.role },
      },
    });

    return { ...updated, permissions: ROLE_PERMISSIONS[updated.role as AdminRole] || [] };
  }

  async deleteUser(id: string, currentUserId: string) {
    const user = await this.prisma.admin.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.admin.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId: currentUserId,
        entityType: 'Admin',
        entityId: id,
        action: 'DELETE',
        oldValue: { name: user.name, email: user.email },
      },
    });

    return { deleted: true };
  }

  async toggleUserStatus(id: string, status: 'ACTIVE' | 'INACTIVE', currentUserId: string) {
    const user = await this.prisma.admin.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.admin.update({
      where: { id },
      data: { status },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId: currentUserId,
        entityType: 'Admin',
        entityId: id,
        action: status === 'ACTIVE' ? 'ACTIVATE' : 'SUSPEND',
        oldValue: { status: user.status },
        newValue: { status },
      },
    });

    return { id: updated.id, status: updated.status };
  }

  async getRoles() {
    return Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
      role,
      permissions,
    }));
  }

  // ==================== APPROVAL LOGS ====================

  async getApprovalLogs(query: PaginationDto & { action?: string; entityType?: string; startDate?: string; endDate?: string }) {
    const { page = 1, limit = 20, action, entityType, startDate, endDate } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where: Record<string, unknown> = {
      action: { in: ['APPROVE', 'REJECT'] },
    };

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async getApprovalStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalApprovals, totalRejections, recentActivity] = await Promise.all([
      this.prisma.auditLog.count({ where: { action: 'APPROVE' } }),
      this.prisma.auditLog.count({ where: { action: 'REJECT' } }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: thirtyDaysAgo }, action: { in: ['APPROVE', 'REJECT'] } },
        _count: true,
      }),
    ]);

    const byAction: Record<string, number> = { APPROVE: 0, REJECT: 0 };
    recentActivity.forEach(item => { byAction[item.action] = item._count; });

    return {
      totalApprovals,
      totalRejections,
      recentApprovals: byAction.APPROVE,
      recentRejections: byAction.REJECT,
    };
  }
}
