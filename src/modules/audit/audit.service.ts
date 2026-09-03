import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditAction } from '@prisma/client';

export interface CreateAuditLogDto {
  adminId?: string;
  clientId?: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  device?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType: dto.entityType,
          entityId: dto.entityId,
          action: dto.action,
          oldValue: dto.oldValue as object | undefined,
          newValue: dto.newValue as object | undefined,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
          device: dto.device,
          ...(dto.adminId ? { adminId: dto.adminId } : {}),
          ...(dto.clientId ? { clientId: dto.clientId } : {}),
        },
      });
    } catch (error) {
      // Audit logging must never break the main flow
      this.logger.error('Failed to write audit log', error);
    }
  }

  async getLogs(filters: {
    adminId?: string;
    clientId?: string;
    entityType?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 20, adminId, clientId, entityType, action, startDate, endDate } = filters;
    const skip = (page - 1) * limit;

    const where = {
      ...(adminId && { adminId }),
      ...(clientId && { clientId }),
      ...(entityType && { entityType }),
      ...(action && { action }),
      ...(startDate && endDate && { createdAt: { gte: startDate, lte: endDate } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
