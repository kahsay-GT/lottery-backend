import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors, ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import {
  ApproveSubscriptionDto,
  CreateSubscriptionDto,
  RejectSubscriptionDto,
  SubmitPaymentSlipDto,
  UpgradeSubscriptionDto,
} from './dto/subscription.dto';

@ApiTags('Plans & Subscriptions')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  // ==================== PUBLIC PLAN LISTING ====================

  @Public()
  @Get()
  @ApiOperation({ summary: 'List active plans (public)' })
  listPublicPlans(@Query() query: PaginationDto) {
    return this.plansService.listPlans(query, true);
  }

  // ==================== ADMIN PLAN MANAGEMENT ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Post('admin')
  @ApiOperation({ summary: 'Create a plan (admin)' })
  createPlan(@Body() dto: CreatePlanDto) {
    return this.plansService.createPlan(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/all')
  @ApiOperation({ summary: 'List all plans (admin)' })
  listAllPlans(@Query() query: PaginationDto) {
    return this.plansService.listPlans(query, false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Patch('admin/:id')
  @ApiOperation({ summary: 'Update a plan (admin)' })
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.updatePlan(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Delete('admin/:id')
  @ApiOperation({ summary: 'Delete a plan (admin)' })
  deletePlan(@Param('id') id: string) {
    return this.plansService.deletePlan(id);
  }

  // ==================== ADMIN SUBSCRIPTION MANAGEMENT ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/subscription-transactions')
  @ApiOperation({ summary: 'List all subscription payment transactions (admin)' })
  listAllSubscriptionTransactions(@Query() query: PaginationDto) {
    return this.plansService.listAllSubscriptionTransactions(query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/subscriptions')
  @ApiOperation({ summary: 'List all subscriptions (admin)' })
  listAllSubscriptions(@Query() query: PaginationDto) {
    return this.plansService.listAllSubscriptions(query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/subscriptions/:id')
  @ApiOperation({ summary: 'Get subscription details (admin)' })
  getSubscription(@Param('id') id: string) {
    return this.plansService.getSubscription(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/subscriptions/:id/slip-url')
  @ApiOperation({ summary: 'Get presigned URL for payment slip (admin)' })
  getSlipUrl(@Param('id') id: string) {
    return this.plansService.getSlipPresignedUrl(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Patch('admin/subscriptions/:id/approve')
  @ApiOperation({ summary: 'Approve a subscription (admin)' })
  approveSubscription(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApproveSubscriptionDto,
  ) {
    return this.plansService.approveSubscription(id, user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Patch('admin/subscriptions/:id/reject')
  @ApiOperation({ summary: 'Reject a subscription (admin)' })
  rejectSubscription(@Param('id') id: string, @Body() dto: RejectSubscriptionDto) {
    return this.plansService.rejectSubscription(id, dto);
  }

  // ==================== CLIENT SUBSCRIPTION ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe to a plan (client)' })
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSubscriptionDto) {
    return this.plansService.subscribe(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('my-subscriptions')
  @ApiOperation({ summary: 'List my subscriptions (client)' })
  mySubscriptions(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.plansService.getClientSubscriptions(user.id, query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('my-subscription/active')
  @ApiOperation({ summary: 'Get my active subscription (client)' })
  getActiveSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.plansService.getClientActiveSubscription(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch('my-subscriptions/:id/cancel')
  @ApiOperation({ summary: 'Cancel my subscription (client)' })
  cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.plansService.cancelSubscription(user.id, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('my-subscriptions/:id/submit-slip')
  @ApiOperation({ summary: 'Upload payment slip for a subscription (client)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, notes: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  submitPaymentSlip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
    dto: SubmitPaymentSlipDto,
  ) {
    return this.plansService.submitPaymentSlip(user.id, id, file, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('my-subscriptions/:id/upgrade')
  @ApiOperation({ summary: 'Upgrade my subscription (client)' })
  upgradeSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.plansService.upgradeSubscription(user.id, id, dto);
  }

  // ==================== PUBLIC PLAN DETAIL — must be last to avoid shadowing literal routes ====================

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get plan details (public)' })
  getPlan(@Param('id') id: string) {
    return this.plansService.getPlan(id);
  }
}
