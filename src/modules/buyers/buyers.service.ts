import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import { RegisterBuyerDto } from '../auth/dto/register-buyer.dto';
import { UpdateBuyerProfileDto } from '../auth/dto/register-buyer.dto';
import { DateUtil } from '../../common/utils/date.util';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { ROLES } from '../../common/constants';
import { JwtPayload, RefreshTokenPayload } from '../../common/interfaces/jwt-payload.interface';

@Injectable()
export class BuyersService {
  private readonly logger = new Logger(BuyersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createBuyerWithAuth(dto: RegisterBuyerDto) {
    const existing = await this.prisma.buyer.findUnique({
      where: { clientId_email: { clientId: dto.clientId, email: dto.email } },
    });
    if (existing) throw new BadRequestException('Email already registered with this operator');

    const hashedPassword = await argon2.hash(dto.password);

    const buyer = await this.prisma.buyer.create({
      data: {
        clientId: dto.clientId,
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        password: hashedPassword,
        status: 'ACTIVE',
      },
    });

    // Bridge: sync new Buyer to unified users table (fire-and-forget)
    this.prisma.user.upsert({
      where: { legacyId_legacyTable: { legacyId: buyer.id, legacyTable: 'buyers' } },
      create: {
        email: buyer.email ?? null,
        phone: buyer.phone ?? null,
        name: buyer.name,
        password: hashedPassword,
        role: 'buyer',
        status: 'ACTIVE',
        clientId: buyer.clientId,
        legacyId: buyer.id,
        legacyTable: 'buyers',
      },
      update: {},
    }).catch(err => this.logger.warn(`Bridge upsert failed for buyer:${buyer.id}: ${err.message}`));

    // Generate tokens
    const tokens = await this.generateTokens(buyer.id, buyer.email ?? '', ROLES.BUYER);
    await this.saveRefreshToken(tokens.refreshToken, undefined, undefined, buyer.id);

    return {
      ...tokens,
      user: { id: buyer.id, email: buyer.email ?? '', name: buyer.name, role: ROLES.BUYER, clientId: buyer.clientId },
    };
  }

  async getBuyerById(buyerId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        isGuest: false,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        client: { select: { id: true, businessName: true } },
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return buyer;
  }

  async updateProfile(buyerId: string, dto: UpdateBuyerProfileDto) {
    return this.prisma.buyer.update({
      where: { id: buyerId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.phone && { phone: dto.phone }),
      },
      select: { id: true, email: true, name: true, phone: true, status: true },
    });
  }

  async getBuyerTickets(buyerId: string) {
    const tickets = await this.prisma.lotteryTicket.findMany({
      where: { buyerId },
      include: {
        lottery: {
          select: { id: true, name: true, status: true, drawDate: true, ticketPrice: true },
        },
        payment: { select: { referenceCode: true, status: true, amount: true, approvedAt: true } },
      },
      orderBy: { purchasedAt: 'desc' },
    });
    return { data: tickets, total: tickets.length };
  }

  async getBuyerPayments(buyerId: string) {
    const payments = await this.prisma.paymentTransaction.findMany({
      where: { buyerId },
      include: {
        lottery: { select: { id: true, name: true } },
        tickets: { select: { ticketNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: payments, total: payments.length };
  }

  // ==================== HELPERS ====================

  private async generateTokens(sub: string, email: string, role: string) {
    const accessPayload: JwtPayload = { sub, email, role };
    const refreshPayload: RefreshTokenPayload = {
      sub,
      tokenId: CryptoUtil.generateRandomToken(16),
      role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.get<string>('jwt.accessSecret') || 'access-secret',
        expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.get<string>('jwt.refreshSecret') || 'refresh-secret',
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(token: string, adminId?: string, clientId?: string, buyerId?: string, ipAddress?: string) {
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn') || '7d';
    const days = parseInt(expiresIn.replace('d', ''), 10) || 7;

    await this.prisma.refreshToken.create({
      data: {
        token,
        adminId,
        clientId,
        buyerId,
        ipAddress,
        expiresAt: DateUtil.addDays(new Date(), days),
      },
    });
  }
}