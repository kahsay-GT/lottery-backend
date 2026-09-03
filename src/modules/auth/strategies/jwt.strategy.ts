import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../database/prisma.service';
import { ROLES } from '../../../common/constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret') || 'access-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const { sub, role } = payload;

    if (role === ROLES.SUPER_ADMIN) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: sub, deletedAt: null },
      });
      if (!admin || admin.status === 'SUSPENDED') {
        throw new UnauthorizedException('Account is inactive or suspended');
      }
      return { id: admin.id, email: admin.email, role };
    }

    if (role === ROLES.CLIENT) {
      const client = await this.prisma.client.findUnique({
        where: { id: sub, deletedAt: null },
      });
      if (!client || client.status === 'SUSPENDED') {
        throw new UnauthorizedException('Account is inactive or suspended');
      }
      return { id: client.id, email: client.email, role, clientId: client.id };
    }

    if (role === ROLES.BUYER) {
      const buyer = await this.prisma.buyer.findUnique({
        where: { id: sub, deletedAt: null },
      });
      if (!buyer) {
        throw new UnauthorizedException('Buyer not found');
      }
      return { id: buyer.id, email: buyer.email ?? '', role, clientId: buyer.clientId };
    }

    if (role === ROLES.STAFF) {
      const staff = await this.prisma.clientStaff.findUnique({
        where: { id: sub, deletedAt: null },
      });
      if (!staff || !staff.isActive) {
        throw new UnauthorizedException('Staff account is inactive');
      }
      return {
        id: staff.id,
        email: staff.email,
        role,
        clientId: staff.clientId,
        staffId: staff.id,
        staffRole: staff.role,
      };
    }

    // also handle admin/manager roles stored as plain strings
    const admin = await this.prisma.admin.findUnique({ where: { id: sub, deletedAt: null } });
    if (admin) return { id: admin.id, email: admin.email, role };

    throw new UnauthorizedException('Invalid token');
  }
}
