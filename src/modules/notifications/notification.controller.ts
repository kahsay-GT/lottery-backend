import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // ── Admin: all notifications history ──────────────────────────────
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin')
  @ApiOperation({ summary: 'List all platform notifications (admin)' })
  adminList(@Query() query: PaginationDto) {
    return this.notificationService.getNotifications({ page: query.page, limit: query.limit });
  }

  // ── Admin: notification templates ─────────────────────────────────
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/templates')
  @ApiOperation({ summary: 'List notification templates (admin)' })
  adminTemplates() {
    return this.notificationService.getNotificationTemplates();
  }

  // ── Client: their notifications ────────────────────────────────────
  @UseGuards(RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('my')
  @ApiOperation({ summary: 'My notifications (client)' })
  myNotifications(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.notificationService.getNotifications({
      clientId: user.id,
      page: query.page,
      limit: query.limit,
    });
  }

  // ── Buyer: their notifications ─────────────────────────────────────
  @UseGuards(RolesGuard)
  @Roles(ROLES.BUYER)
  @Get('buyer')
  @ApiOperation({ summary: 'My notifications (buyer)' })
  buyerNotifications(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.notificationService.getNotifications({
      buyerId: user.id,
      page: query.page,
      limit: query.limit,
    });
  }

  // ── Mark as read ───────────────────────────────────────────────────
  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Param('id') id: string) {
    return this.notificationService.markRead(id);
  }
}
