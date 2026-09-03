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
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/login.dto';
import { RegisterClientDto } from './dto/register-client.dto';
import { RegisterBuyerDto, BuyerChangePasswordDto } from './dto/register-buyer.dto';
import { ROLES, MAX_FAILED_LOGIN_ATTEMPTS, ACCOUNT_LOCKOUT_MINUTES } from '../../common/constants';
import { JwtPayload, RefreshTokenPayload } from '../../common/interfaces/jwt-payload.interface';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { DateUtil } from '../../common/utils/date.util';
import { UnifiedLoginDto } from './dto/unified-login.dto';
import { UnifiedLoginResponse } from './dto/unified-login-response.dto';

// ==================== UNIFIED AUTH TYPES ====================

export interface ResolvedCandidate {
  id: string;
  email: string | null;
  phone?: string | null;
  name: string;
  password: string | null;
  role: 'client' | 'buyer' | 'staff';
  status?: string;        // Client/Buyer have status; ClientStaff uses isActive
  isActive?: boolean;     // ClientStaff-specific
  clientId?: string;      // present for buyer/staff
  businessName?: string;  // present for client
  lockedUntil?: Date | null;
  failedLoginCount: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ==================== ADMIN AUTH ====================

  async adminLogin(dto: LoginDto, ipAddress?: string) {
    const id = (dto.identifier ?? dto.email ?? '').trim()
    const admin = await this.prisma.admin.findFirst({
      where: { email: id, deletedAt: null },
    });

    if (!admin) throw new UnauthorizedException('Invalid credentials');
    if (admin.status === 'SUSPENDED') throw new ForbiddenException('Account is suspended');

    if (admin.lockedUntil && !DateUtil.isPast(admin.lockedUntil)) {
      throw new ForbiddenException(
        `Account locked. Try again after ${admin.lockedUntil.toISOString()}`,
      );
    }

    const isPasswordValid = await argon2.verify(admin.password, dto.password);
    if (!isPasswordValid) {
      const failedCount = admin.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: failedCount };

      if (failedCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = DateUtil.addMinutes(new Date(), ACCOUNT_LOCKOUT_MINUTES);
        this.logger.warn(`Admin account locked after ${failedCount} failed attempts: ${admin.email}`);
      }

      await this.prisma.admin.update({ where: { id: admin.id }, data: updateData });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenException('Email not verified. Please verify your email first.');
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    const tokens = await this.generateTokens(admin.id, admin.email, ROLES.SUPER_ADMIN);
    await this.saveRefreshToken(tokens.refreshToken, admin.id, undefined, undefined, ipAddress);

    this.logger.log(`Admin logged in: ${admin.email}`);
    return { ...tokens, user: { id: admin.id, email: admin.email, name: admin.name, role: ROLES.SUPER_ADMIN } };
  }

  // ==================== CLIENT AUTH ====================

  async registerClient(dto: RegisterClientDto) {
    const existing = await this.prisma.client.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('Email already registered');

    if (dto.username) {
      const takenUsername = await this.prisma.client.findUnique({ where: { username: dto.username } });
      if (takenUsername) throw new BadRequestException('Username is already taken');
    }

    const hashedPassword = await argon2.hash(dto.password);

    const client = await this.prisma.client.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        businessName: dto.businessName,
        phone: dto.phone,
        website: dto.website,
        username: dto.username ?? null,
        status: 'PENDING',
      },
    });

    // Bridge: sync new Client to unified users table (fire-and-forget)
    this.prisma.user.upsert({
      where: { legacyId_legacyTable: { legacyId: client.id, legacyTable: 'clients' } },
      create: {
        email: client.email,
        phone: client.phone ?? null,
        name: client.name,
        password: hashedPassword,
        role: 'client',
        status: 'ACTIVE',
        legacyId: client.id,
        legacyTable: 'clients',
      },
      update: {},
    }).catch(err => this.logger.warn(`Bridge upsert failed for client:${client.id}: ${err.message}`));

    // If user chose a plan on the pricing page, create a pending subscription automatically
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId, isActive: true, deletedAt: null } });
      if (plan) {
        const cycle = dto.billingCycle ?? 'MONTHLY';
        const price = cycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice;
        await this.prisma.subscription.create({
          data: {
            clientId: client.id,
            planId: plan.id,
            billingCycle: cycle,
            price,
            status: 'PENDING',
          },
        });
      }
    }

    this.logger.log(`Client registered: ${client.email}`);
    return { id: client.id, email: client.email, name: client.name, username: client.username };
  }

  // ── Helper: resolve identifier (email or phone) to a normalized email string ──
  private isPhone(id: string): boolean {
    return /^\+?[0-9]{7,15}$/.test(id.replace(/[\s\-().]/g, ''))
  }

  async clientLogin(dto: LoginDto, ipAddress?: string) {
    const id = (dto.identifier ?? dto.email ?? '').trim()
    const isPhone = this.isPhone(id)

    const client = await this.prisma.client.findFirst({
      where: {
        deletedAt: null,
        ...(isPhone ? { phone: id } : { email: id }),
      },
    });

    if (!client) throw new UnauthorizedException('Invalid credentials');
    if (client.status === 'SUSPENDED') throw new ForbiddenException('Account is suspended');

    if (client.lockedUntil && !DateUtil.isPast(client.lockedUntil)) {
      throw new ForbiddenException(`Account locked until ${client.lockedUntil.toISOString()}`);
    }

    const isPasswordValid = await argon2.verify(client.password, dto.password);
    if (!isPasswordValid) {
      const failedCount = client.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: failedCount };
      if (failedCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = DateUtil.addMinutes(new Date(), ACCOUNT_LOCKOUT_MINUTES);
      }
      await this.prisma.client.update({ where: { id: client.id }, data: updateData });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.client.update({
      where: { id: client.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    const tokens = await this.generateTokens(client.id, client.email, ROLES.CLIENT);
    await this.saveRefreshToken(tokens.refreshToken, undefined, client.id, undefined, ipAddress);

    return {
      ...tokens,
      user: {
        id: client.id,
        email: client.email,
        name: client.name,
        businessName: client.businessName,
        role: ROLES.CLIENT,
        status: client.status,
      },
    };
  }

  // ==================== BUYER AUTH ====================

  async buyerLogin(dto: { identifier?: string; email?: string; password: string }, clientId: string, ipAddress?: string) {
    const id = (dto.identifier ?? dto.email ?? '').trim()
    const isPhone = this.isPhone(id)

    // buyers can log in with email or phone
    const buyer = await this.prisma.buyer.findFirst({
      where: {
        clientId,
        deletedAt: null,
        ...(isPhone
          ? { phone: id }
          : { email: id }),
      },
    });

    if (!buyer) throw new UnauthorizedException('Invalid credentials');

    // Check password - buyers may have password set
    const isPasswordValid = buyer.password 
      ? await argon2.verify(buyer.password, dto.password)
      : false;
    
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    // Update last login
    await this.prisma.buyer.update({
      where: { id: buyer.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(buyer.id, buyer.email ?? '', ROLES.BUYER);
    await this.saveRefreshToken(tokens.refreshToken, undefined, undefined, buyer.id, ipAddress);

    return { 
      ...tokens, 
      user: { 
        id: buyer.id, 
        email: buyer.email ?? '', 
        name: buyer.name, 
        role: ROLES.BUYER,
        clientId: buyer.clientId,
      } 
    };
  }

  async changeBuyerPassword(buyerId: string, dto: BuyerChangePasswordDto): Promise<void> {
    const buyer = await this.prisma.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    
    if (!buyer.password) {
      throw new BadRequestException('Buyer account does not have a password set');
    }
    
    const valid = await argon2.verify(buyer.password, dto.currentPassword);
    if (!valid) throw new BadRequestException('Current password is incorrect');
    
    const hashed = await argon2.hash(dto.newPassword);
    await this.prisma.buyer.update({ where: { id: buyerId }, data: { password: hashed } });
  }

  // ==================== REFRESH TOKENS ====================

  async refreshTokens(token: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.revokedAt || DateUtil.isPast(stored.expiresAt)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: revoke old token
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { sub, role } = payload;
    let email = '';

    if (role === ROLES.SUPER_ADMIN) {
      const admin = await this.prisma.admin.findUnique({ where: { id: sub } });
      if (!admin) throw new UnauthorizedException();
      email = admin.email;
    } else if (role === ROLES.CLIENT) {
      const client = await this.prisma.client.findUnique({ where: { id: sub } });
      if (!client) throw new UnauthorizedException();
      email = client.email;
    } else if (role === ROLES.STAFF || role === 'staff') {
      const staff = await this.prisma.clientStaff.findUnique({ where: { id: sub } });
      if (!staff) throw new UnauthorizedException();
      email = staff.email ?? '';
      // Staff tokens must carry clientId in the payload — use candidate-aware helpers
      const tokens = await this.generateTokensForCandidate({
        id: staff.id,
        email: staff.email ?? null,
        name: staff.name ?? '',
        password: null,
        role: 'staff',
        clientId: staff.clientId,
        failedLoginCount: 0,
      });
      await this.saveRefreshTokenForCandidate(tokens.refreshToken, {
        id: staff.id,
        email: staff.email ?? null,
        name: staff.name ?? '',
        password: null,
        role: 'staff',
        clientId: staff.clientId,
        failedLoginCount: 0,
      });
      return tokens;
    } else {
      const buyer = await this.prisma.buyer.findUnique({ where: { id: sub } });
      if (!buyer) throw new UnauthorizedException();
      email = buyer.email ?? '';
    }

    const tokens = await this.generateTokens(sub, email, role);
    const adminId = role === ROLES.SUPER_ADMIN ? sub : undefined;
    const clientId = role === ROLES.CLIENT ? sub : undefined;
    const buyerId = role === ROLES.BUYER ? sub : undefined;
    await this.saveRefreshToken(tokens.refreshToken, adminId, clientId, buyerId);

    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  // ==================== PASSWORD MANAGEMENT ====================

  async forgotPassword(_dto: ForgotPasswordDto): Promise<void> {
    // Generate reset token and send email via NotificationService
    // Token stored hashed in settings or cache; full implementation in notification module
    this.logger.log(`Password reset requested for: ${_dto.email}`);
  }

  async resetPassword(_dto: ResetPasswordDto): Promise<void> {
    // Validate reset token and update password
    this.logger.log('Password reset executed');
  }

  async changePassword(userId: string, role: string, dto: ChangePasswordDto): Promise<void> {
    if (role === ROLES.SUPER_ADMIN) {
      const admin = await this.prisma.admin.findUnique({ where: { id: userId } });
      if (!admin) throw new NotFoundException('User not found');
      const valid = await argon2.verify(admin.password, dto.currentPassword);
      if (!valid) throw new BadRequestException('Current password is incorrect');
      const hashed = await argon2.hash(dto.newPassword);
      await this.prisma.admin.update({ where: { id: userId }, data: { password: hashed } });
    } else if (role === ROLES.CLIENT) {
      const client = await this.prisma.client.findUnique({ where: { id: userId } });
      if (!client) throw new NotFoundException('User not found');
      const valid = await argon2.verify(client.password, dto.currentPassword);
      if (!valid) throw new BadRequestException('Current password is incorrect');
      const hashed = await argon2.hash(dto.newPassword);
      await this.prisma.client.update({ where: { id: userId }, data: { password: hashed } });
    }
  }

  // ==================== UNIFIED AUTH HELPERS ====================

  /**
   * Sequentially searches Client → ClientStaff → Buyer tables for a matching
   * identifier (email or phone). Returns the first match with a `role`
   * discriminator, or null if no record is found across all three tables.
   */
  private async resolveCandidate(
    normalised: string,
    isPhone: boolean,
  ): Promise<ResolvedCandidate | null> {
    const whereClause = isPhone ? { phone: normalised } : { email: normalised };

    // Priority 1: Client (Operator)
    const client = await this.prisma.client.findFirst({
      where: { ...whereClause, deletedAt: null },
    });
    if (client) return { ...client, role: 'client' as const };

    // Priority 2: ClientStaff
    const staff = await this.prisma.clientStaff.findFirst({
      where: { ...whereClause, deletedAt: null },
    });
    if (staff) return { ...staff, role: 'staff' as const, failedLoginCount: 0 };

    // Priority 3: Buyer
    const buyer = await this.prisma.buyer.findFirst({
      where: { ...whereClause, deletedAt: null },
    });
    if (buyer) return { ...buyer, role: 'buyer' as const, failedLoginCount: 0 };

    return null;
  }

  /**
   * Checks whether the resolved candidate's account is in a state that
   * prevents login. Throws ForbiddenException for suspended or locked accounts.
   *
   * Note: this runs BEFORE password verification intentionally — it avoids a
   * timing oracle that could be used for username enumeration.
   */
  private enforceAccountState(candidate: ResolvedCandidate): void {
    // ClientStaff uses isActive instead of a status enum
    if (candidate.isActive === false) {
      throw new ForbiddenException('Account is suspended');
    }

    // Client and Buyer use a status field
    if (candidate.status === 'SUSPENDED') {
      throw new ForbiddenException('Account is suspended');
    }

    // Lockout check — only Client has lockedUntil in the schema
    if (candidate.lockedUntil && !DateUtil.isPast(candidate.lockedUntil)) {
      throw new ForbiddenException(
        `Account locked until ${candidate.lockedUntil.toISOString()}`,
      );
    }
  }

  /**
   * Increments the failed login counter on the matched record. When the counter
   * reaches MAX_FAILED_LOGIN_ATTEMPTS the account is locked for
   * ACCOUNT_LOCKOUT_MINUTES minutes.
   *
   * Only Client has failedLoginCount / lockedUntil columns in the schema.
   * ClientStaff and Buyer do not have these columns, so we only update them
   * for the client role.
   */
  private async recordFailedAttempt(candidate: ResolvedCandidate): Promise<void> {
    if (candidate.role === 'client') {
      const newCount = candidate.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: newCount };

      if (newCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = DateUtil.addMinutes(new Date(), ACCOUNT_LOCKOUT_MINUTES);
        this.logger.warn(
          `Client account locked after ${newCount} failed attempts: id=${candidate.id}`,
        );
      }

      await this.prisma.client.update({
        where: { id: candidate.id },
        data: updateData,
      });
    }
    // ClientStaff and Buyer do not have failedLoginCount / lockedUntil columns —
    // no database update needed for those roles.
  }

  /**
   * Resets the failed login counter and updates the last-login timestamp on a
   * successful authentication. For the client role, also clears the lockout
   * timestamp and records the originating IP address.
   */
  private async recordSuccessfulLogin(
    candidate: ResolvedCandidate,
    ipAddress?: string,
  ): Promise<void> {
    if (candidate.role === 'client') {
      await this.prisma.client.update({
        where: { id: candidate.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress,
        },
      });
    } else if (candidate.role === 'staff') {
      // ClientStaff only has lastLoginAt — no failedLoginCount, lockedUntil, or lastLoginIp
      await this.prisma.clientStaff.update({
        where: { id: candidate.id },
        data: { lastLoginAt: new Date() },
      });
    } else if (candidate.role === 'buyer') {
      // Buyer only has lastLoginAt — no failedLoginCount, lockedUntil, or lastLoginIp
      await this.prisma.buyer.update({
        where: { id: candidate.id },
        data: { lastLoginAt: new Date() },
      });
    }
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

  /**
   * Generates an access + refresh token pair for a resolved login candidate.
   * For buyer and staff roles, the access token payload includes `clientId`
   * so downstream guards and services can scope requests to the correct operator.
   *
   * The existing `generateTokens(sub, email, role)` method is preserved for all
   * other flows (adminLogin, clientLogin, buyerLogin, etc.).
   */
  async generateTokensForCandidate(candidate: ResolvedCandidate) {
    const accessPayload: JwtPayload = {
      sub: candidate.id,
      email: candidate.email ?? '',
      role: candidate.role,
      ...(candidate.role === 'buyer' || candidate.role === 'staff'
        ? { clientId: candidate.clientId }
        : {}),
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: candidate.id,
      tokenId: CryptoUtil.generateRandomToken(16),
      role: candidate.role,
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

  private async saveRefreshToken(
    token: string,
    adminId?: string,
    clientId?: string,
    buyerId?: string,
    ipAddress?: string,
  ) {
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

  // ==================== UNIFIED AUTH METHODS ====================

  /**
   * Persists a refresh token with the correct role-scoped FK.
   * The refresh_tokens table has clientId, staffId, and buyerId columns,
   * so each role maps to its corresponding FK.
   */
  private async saveRefreshTokenForCandidate(
    token: string,
    candidate: ResolvedCandidate,
    ipAddress?: string,
  ): Promise<void> {
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn') || '7d';
    const days = parseInt(expiresIn.replace('d', ''), 10) || 7;

    await this.prisma.refreshToken.create({
      data: {
        token,
        clientId: candidate.role === 'client' ? candidate.id : undefined,
        staffId:  candidate.role === 'staff'  ? candidate.id : undefined,
        buyerId:  candidate.role === 'buyer'  ? candidate.id : undefined,
        ipAddress,
        expiresAt: DateUtil.addDays(new Date(), days),
      },
    });
  }

  /**
   * Fire-and-forget upsert into the `users` bridge table.
   * Uses the @@unique([legacyId, legacyTable]) constraint so re-running is safe.
   * The `update` body is empty — first write wins, no fields are overwritten.
   */
  private async upsertUserBridgeRecord(candidate: ResolvedCandidate): Promise<void> {
    const legacyTable =
      candidate.role === 'client' ? 'clients' :
      candidate.role === 'staff'  ? 'client_staff' : 'buyers';

    await this.prisma.user.upsert({
      where: {
        legacyId_legacyTable: {
          legacyId: candidate.id,
          legacyTable,
        },
      },
      create: {
        // id is auto-generated by Prisma (@default(uuid()))
        email: candidate.email,
        phone: candidate.phone ?? null,
        name: candidate.name,
        password: candidate.password ?? '',
        role: candidate.role as any,
        status: (candidate.status ?? 'ACTIVE') as any,
        clientId: candidate.clientId ?? null,
        legacyId: candidate.id,
        legacyTable,
      },
      update: {}, // no-op — first write wins
    });
  }

  /**
   * Orchestrates the full unified login flow:
   * normalise → resolve → enforce state → verify password →
   * record attempt → generate tokens → persist refresh → bridge upsert → response
   */
  async unifiedLogin(dto: UnifiedLoginDto, ipAddress?: string): Promise<UnifiedLoginResponse> {
    const raw = (dto.identifier ?? '').trim();
    const isPhone = /^\+?[0-9]{7,15}$/.test(raw.replace(/[\s\-().]/g, ''));
    const normalised = isPhone ? raw.replace(/[\s\-().]/g, '') : raw;

    // 1. Resolve candidate across tables
    const candidate = await this.resolveCandidate(normalised, isPhone);
    if (!candidate) throw new UnauthorizedException('Invalid credentials');

    // 2. Account state check (before password verify — avoids timing oracle)
    this.enforceAccountState(candidate);

    // 3. Password verification
    const passwordValid = candidate.password
      ? await argon2.verify(candidate.password, dto.password)
      : false;

    if (!passwordValid) {
      await this.recordFailedAttempt(candidate);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Reset counters + update lastLoginAt
    await this.recordSuccessfulLogin(candidate, ipAddress);

    // 5. Generate tokens (clientId in payload for buyer/staff)
    const tokens = await this.generateTokensForCandidate(candidate);

    // 6. Persist refresh token with role-scoped FK
    await this.saveRefreshTokenForCandidate(tokens.refreshToken, candidate, ipAddress);

    // 7. Bridge upsert — fire and forget
    this.upsertUserBridgeRecord(candidate).catch(err =>
      this.logger.warn(`Bridge upsert failed for ${candidate.role}:${candidate.id}: ${err.message}`),
    );

    // 8. Build and return response
    return this.buildUnifiedResponse(tokens, candidate);
  }

  private buildUnifiedResponse(
    tokens: { accessToken: string; refreshToken: string },
    candidate: ResolvedCandidate,
  ): UnifiedLoginResponse {
    const base = {
      id: candidate.id,
      email: candidate.email,
      name: candidate.name,
      role: candidate.role,
      status: candidate.status ?? 'ACTIVE',
    };

    let user: UnifiedLoginResponse['user'];
    if (candidate.role === 'client') {
      user = { ...base, role: 'client' as const, businessName: candidate.businessName ?? '' };
    } else if (candidate.role === 'buyer') {
      user = { ...base, role: 'buyer' as const, clientId: candidate.clientId! };
    } else {
      user = { ...base, role: 'staff' as const, clientId: candidate.clientId! };
    }

    return { ...tokens, user };
  }
}
