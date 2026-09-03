import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  CreateAdminDto,
  CreateBankAccountDto,
  SystemSettingDto,
  ToggleBankAccountStatusDto,
  ToggleClientVerifiedDto,
  UpdateBankAccountDto,
  UpdateClientStatusDto,
} from './dto/admin.dto';
import {
  AdminRole,
  AssignPermissionsDto,
  CreateUserDto,
  UpdateUserDto,
} from './dto/user-management.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ==================== DASHBOARD ====================

  @Get('dashboard')
  @ApiOperation({ summary: 'Platform KPI dashboard' })
  getDashboard() {
    return this.adminService.getPlatformDashboard();
  }

  @Get('dashboard/revenue')
  @ApiOperation({ summary: 'Revenue chart data' })
  getRevenueChart(@Query('period') period: 'daily' | 'monthly') {
    return this.adminService.getRevenueChart(period || 'monthly');
  }

  // ==================== CLIENTS ====================

  @Get('clients')
  @ApiOperation({ summary: 'List all clients' })
  listClients(@Query() query: PaginationDto) {
    return this.adminService.listClients(query);
  }

  @Get('clients/:id')
  @ApiOperation({ summary: 'Get client details' })
  getClient(@Param('id') id: string) {
    return this.adminService.getClient(id);
  }

  @Patch('clients/:id/status')
  @ApiOperation({ summary: 'Activate or suspend a client' })
  updateClientStatus(
    @Param('id') id: string,
    @Body() dto: UpdateClientStatusDto,
  ) {
    return this.adminService.updateClientStatus(id, dto);
  }

  @Patch('clients/:id/verify')
  @ApiOperation({ summary: 'Grant or revoke verified badge for a client' })
  toggleClientVerified(
    @Param('id') id: string,
    @Body() dto: ToggleClientVerifiedDto,
  ) {
    return this.adminService.toggleClientVerified(id, dto.isVerified);
  }

  @Delete('clients/:id')
  @ApiOperation({ summary: 'Soft-delete a client' })
  deleteClient(@Param('id') id: string) {
    return this.adminService.deleteClient(id);
  }

  // ==================== LOTTERIES ====================

  @Get('lotteries')
  @ApiOperation({ summary: 'View all lotteries across all clients' })
  listAllLotteries(@Query() query: PaginationDto) {
    return this.adminService.listAllLotteries(query);
  }

  // ==================== ADMINS ====================

  @Post('admins')
  @ApiOperation({ summary: 'Create a new admin account' })
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.adminService.createAdmin(dto);
  }

  @Get('admins')
  @ApiOperation({ summary: 'List all admins' })
  listAdmins(@Query() query: PaginationDto) {
    return this.adminService.listAdmins(query);
  }

  // ==================== SETTINGS ====================

  @Get('settings')
  @ApiOperation({ summary: 'Get all system settings' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Post('settings')
  @ApiOperation({ summary: 'Create or update a system setting' })
  upsertSetting(@Body() dto: SystemSettingDto) {
    return this.adminService.upsertSetting(dto);
  }

  // ==================== AUDIT LOGS ====================

  @Get('audit-logs')
  @ApiOperation({ summary: 'View platform audit logs' })
  getAuditLogs(@Query() query: PaginationDto) {
    return this.adminService.getAuditLogs(query);
  }

  // ==================== PLATFORM BANK ACCOUNTS ====================

  @Get('bank-accounts')
  @ApiOperation({ summary: 'List all platform bank accounts' })
  listBankAccounts() {
    return this.adminService.listBankAccounts();
  }

  @Get('bank-accounts/:id')
  @ApiOperation({ summary: 'Get a single bank account' })
  getBankAccount(@Param('id') id: string) {
    return this.adminService.getBankAccount(id);
  }

  @Post('bank-accounts')
  @ApiOperation({ summary: 'Create a new platform bank account' })
  createBankAccount(@Body() dto: CreateBankAccountDto) {
    return this.adminService.createBankAccount(dto);
  }

  @Patch('bank-accounts/:id')
  @ApiOperation({ summary: 'Update a platform bank account' })
  updateBankAccount(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.adminService.updateBankAccount(id, dto);
  }

  @Patch('bank-accounts/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a bank account' })
  toggleBankAccountStatus(@Param('id') id: string, @Body() dto: ToggleBankAccountStatusDto) {
    return this.adminService.toggleBankAccountStatus(id, dto);
  }

  @Delete('bank-accounts/:id')
  @ApiOperation({ summary: 'Delete a platform bank account' })
  deleteBankAccount(@Param('id') id: string) {
    return this.adminService.deleteBankAccount(id);
  }

  // ==================== USER MANAGEMENT ====================

  @Post('users')
  @ApiOperation({ summary: 'Create a new admin user' })
  createUser(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.createUser(dto, user.id);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all admin users with roles and permissions' })
  listUsers(@Query() query: PaginationDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user details with permissions' })
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user details' })
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.updateUser(id, dto, user.id);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Soft-delete a user' })
  deleteUser(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.deleteUser(id, user.id);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate or suspend a user' })
  toggleUserStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'INACTIVE' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.toggleUserStatus(id, body.status, user.id);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get all available roles with their permissions' })
  getRoles() {
    return this.adminService.getRoles();
  }

  // ==================== APPROVAL LOGS ====================

  @Get('approval-logs')
  @ApiOperation({ summary: 'View all approval/rejection logs (payments, operators, subscriptions)' })
  getApprovalLogs(@Query() query: PaginationDto & { action?: string; entityType?: string; startDate?: string; endDate?: string }) {
    return this.adminService.getApprovalLogs(query);
  }

  @Get('approval-logs/stats')
  @ApiOperation({ summary: 'Get approval/rejection statistics' })
  getApprovalStats() {
    return this.adminService.getApprovalStats();
  }
}
