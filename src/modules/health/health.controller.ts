import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
    };
  }

  /**
   * Public system settings — returns only isPublic=true settings.
   */
  @Public()
  @Get('settings/public')
  @ApiOperation({ summary: 'Get public platform settings' })
  async publicSettings() {
    return this.prisma.setting.findMany({
      where: { isPublic: true },
      select: { key: true, value: true, group: true },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Public platform bank accounts — active accounts only, no auth required.
   * Used by client subscription page to show payment transfer details.
   */
  @Public()
  @Get('platform/bank-accounts')
  @ApiOperation({ summary: 'Get active platform bank accounts (public)' })
  async publicBankAccounts() {
    return this.prisma.bankAccount.findMany({
      where: { clientId: null, isActive: true },
      include: { bank: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
