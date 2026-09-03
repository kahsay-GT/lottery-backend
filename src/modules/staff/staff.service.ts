import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import { ROLES } from '../../common/constants';
import { JwtPayload, RefreshTokenPayload } from '../../common/interfaces/jwt-payload.interface';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { DateUtil } from '../../common/utils/date.util';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import { CreateStaffDto, UpdateStaffDto, StaffLoginDto } from './dto/staff.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async listStaff(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20, search } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    const where: Record<string, unknown> = { clientId, deletedAt: null };
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.clientStaff.findMany({
        where,
        skip, take,
        select: {
          id: true, name: true, email: true, role: true,
          isActive: true, lastLoginAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.clientStaff.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async createStaff(clientId: string, dto: CreateStaffDto) {
    const existing = await this.prisma.clientStaff.findUnique({
      where: { clientId_email: { clientId, email: dto.email } },
    });
    if (existing) throw new BadRequestException('Email already in use for this operator');

    const password = await argon2.hash(dto.password);
    const staff = await this.prisma.clientStaff.create({
      data: { clientId, name: dto.name, email: dto.email, password, role: dto.role },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    // Bridge: sync new ClientStaff to unified users table (fire-and-forget)
    this.prisma.user.upsert({
      where: { legacyId_legacyTable: { legacyId: staff.id, legacyTable: 'client_staff' } },
      create: {
        email: staff.email ?? null,
        phone: null,
        name: staff.name ?? '',
        password,
        role: 'staff',
        status: 'ACTIVE',
        clientId,
        legacyId: staff.id,
        legacyTable: 'client_staff',
      },
      update: {},
    }).catch(err => this.logger.warn(`Bridge upsert failed for staff:${staff.id}: ${err.message}`));

    return staff;
  }

  async updateStaff(clientId: string, staffId: string, dto: UpdateStaffDto) {
    const staff = await this.prisma.clientStaff.findUnique({ where: { id: staffId } });
    if (!staff || staff.clientId !== clientId) throw new NotFoundException('Staff not found');
    if (staff.deletedAt) throw new NotFoundException('Staff not found');

    const data: Record<string, unknown> = {};
    if (dto.name)     data.name = dto.name;
    if (dto.role)     data.role = dto.role;
    if (dto.password) data.password = await argon2.hash(dto.password);

    return this.prisma.clientStaff.update({
      where: { id: staffId },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true, updatedAt: true },
    });
  }

  async toggleActive(clientId: string, staffId: string) {
    const staff = await this.prisma.clientStaff.findUnique({ where: { id: staffId } });
    if (!staff || staff.clientId !== clientId || staff.deletedAt) {
      throw new NotFoundException('Staff not found');
    }
    return this.prisma.clientStaff.update({
      where: { id: staffId },
      data: { isActive: !staff.isActive },
      select: { id: true, name: true, isActive: true },
    });
  }

  async deleteStaff(clientId: string, staffId: string) {
    const staff = await this.prisma.clientStaff.findUnique({ where: { id: staffId } });
    if (!staff || staff.clientId !== clientId) throw new NotFoundException('Staff not found');

    await this.prisma.clientStaff.update({
      where: { id: staffId },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Staff member removed' };
  }

  // ── Activity log ──────────────────────────────────────────────────────────

  async getStaffActivity(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);

    // Get all staff IDs for this client
    const staffIds = (
      await this.prisma.clientStaff.findMany({
        where: { clientId, deletedAt: null },
        select: { id: true },
      })
    ).map(s => s.id);

    const where = {
      clientId,
      OR: [
        { approvedByStaffId: { in: staffIds } },
        { rejectedByStaffId: { in: staffIds } },
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        skip, take,
        select: {
          id: true,
          referenceCode: true,
          amount: true,
          status: true,
          approvedAt: true,
          reviewedAt: true,
          rejectionReason: true,
          approvedByStaff: { select: { id: true, name: true, email: true, role: true } },
          rejectedByStaff: { select: { id: true, name: true, email: true, role: true } },
          buyer: { select: { name: true, phone: true, email: true } },
          lottery: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async staffLogin(dto: StaffLoginDto, ipAddress?: string) {
    const id = (dto.identifier ?? dto.email ?? '').trim()
    const isPhone = /^\+?[0-9]{7,15}$/.test(id.replace(/[\s\-().]/g, ''))

    const staff = await this.prisma.clientStaff.findFirst({
      where: {
        clientId: dto.clientId,
        deletedAt: null,
        ...(isPhone ? { phone: id } : { email: id }),
      },
    });

    if (!staff || staff.deletedAt) throw new UnauthorizedException('Invalid credentials');
    if (!staff.isActive)           throw new ForbiddenException('Account is deactivated');

    const valid = await argon2.verify(staff.password, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.clientStaff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(staff.id, staff.email, staff.clientId, staff.role);
    await this.saveRefreshToken(tokens.refreshToken, staff.id, ipAddress);

    return {
      ...tokens,
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: ROLES.STAFF,
        staffRole: staff.role,
        clientId: staff.clientId,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async generateTokens(staffId: string, email: string, clientId: string, staffRole: string) {
    const accessPayload: JwtPayload = {
      sub: staffId,
      email,
      role: ROLES.STAFF,
      clientId,
      staffId,
      staffRole,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: staffId,
      tokenId: CryptoUtil.generateRandomToken(16),
      role: ROLES.STAFF,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(token: string, staffId: string, ipAddress?: string) {
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn') || '7d';
    const days = parseInt(expiresIn.replace('d', ''), 10) || 7;

    await this.prisma.refreshToken.create({
      data: {
        token,
        staffId,
        ipAddress,
        expiresAt: DateUtil.addDays(new Date(), days),
      },
    });
  }
}
