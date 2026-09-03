import {
  Controller, Get, Param, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';

@ApiTags('Reports & Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ==================== CLIENT ====================

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/dashboard')
  @ApiOperation({ summary: 'Client dashboard KPIs' })
  clientDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getClientDashboard(user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/lottery/:lotteryId/sales')
  @ApiOperation({ summary: 'Lottery sales report' })
  lotterySalesReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
  ) {
    return this.reportsService.getLotterySalesReport(lotteryId, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Get('client/lottery/:lotteryId/tickets')
  @ApiOperation({ summary: 'Paginated lottery tickets preview' })
  lotteryTicketsReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Query() query: PaginationDto,
  ) {
    const clientId = user.role === ROLES.CLIENT ? user.id : null;
    return this.reportsService.getLotteryTickets(lotteryId, clientId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Get('client/lottery/:lotteryId/buyers')
  @ApiOperation({ summary: 'Paginated lottery buyers preview' })
  lotteryBuyersReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Query() query: PaginationDto,
  ) {
    const clientId = user.role === ROLES.CLIENT ? user.id : null;
    return this.reportsService.getLotteryBuyers(lotteryId, clientId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Get('client/lottery/:lotteryId/payments')
  @ApiOperation({ summary: 'Paginated lottery payments preview' })
  lotteryPaymentsReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Query() query: PaginationDto,
  ) {
    const clientId = user.role === ROLES.CLIENT ? user.id : null;
    return this.reportsService.getLotteryPayments(lotteryId, clientId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Get('client/lottery/:lotteryId/winners')
  @ApiOperation({ summary: 'Paginated lottery winners preview' })
  lotteryWinnersReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Query() query: PaginationDto,
  ) {
    const clientId = user.role === ROLES.CLIENT ? user.id : null;
    return this.reportsService.getLotteryWinners(lotteryId, clientId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/buyers')
  @ApiOperation({ summary: 'Buyer statistics report' })
  buyerReport(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.reportsService.getBuyerReport(user.id, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/buyers/:buyerId/tickets')
  @ApiOperation({ summary: 'Get tickets purchased by a specific buyer' })
  buyerTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buyerId') buyerId: string,
    @Query() query: PaginationDto,
  ) {
    return this.reportsService.getBuyerTickets(user.id, buyerId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/buyers/:buyerId/payments')
  @ApiOperation({ summary: 'Get payments made by a specific buyer' })
  buyerPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('buyerId') buyerId: string,
    @Query() query: PaginationDto,
  ) {
    return this.reportsService.getBuyerPayments(user.id, buyerId, query);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Get('client/lottery/:lotteryId/export/excel')
  @ApiOperation({ summary: 'Export lottery data to Excel' })
  async exportLotteryExcel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotteryId') lotteryId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateLotteryExcel(lotteryId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="lottery-${lotteryId}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('client/export')
  @ApiOperation({ summary: 'Request an async report export' })
  requestExport(@CurrentUser() user: AuthenticatedUser, @Query() query: { lotteryId?: string; type: string; format: 'EXCEL' | 'CSV' | 'PDF' }) {
    return this.reportsService.requestExport({
      clientId: user.id,
      lotteryId: query.lotteryId,
      type: query.type,
      format: query.format,
    });
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('client/exports/:id')
  @ApiOperation({ summary: 'Check export status' })
  getExport(@Param('id') id: string) {
    return this.reportsService.getExport(id);
  }

  // ==================== ADMIN ====================

  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/revenue')
  @ApiOperation({ summary: 'Platform revenue report (admin)' })
  platformRevenue(@Query('period') period: string) {
    return this.reportsService.getPlatformRevenue(period || 'monthly');
  }

  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/subscriptions')
  @ApiOperation({ summary: 'Subscription metrics (admin)' })
  subscriptionMetrics() {
    return this.reportsService.getSubscriptionMetrics();
  }
}
