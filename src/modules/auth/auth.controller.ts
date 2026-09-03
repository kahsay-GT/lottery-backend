import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
} from './dto/login.dto';
import { RegisterClientDto } from './dto/register-client.dto';
import { UnifiedLoginDto } from './dto/unified-login.dto';
import { RegisterBuyerDto, BuyerLoginDto, UpdateBuyerProfileDto, BuyerChangePasswordDto } from './dto/register-buyer.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BuyersService } from '../buyers/buyers.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly buyersService: BuyersService,
  ) {}

  // ==================== UNIFIED AUTH ====================

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unified login — resolves Client, Staff, or Buyer by credential' })
  @ApiBody({ type: UnifiedLoginDto })
  unifiedLogin(@Body() dto: UnifiedLoginDto, @Req() req: Request) {
    return this.authService.unifiedLogin(dto, req.ip);
  }

  // ==================== ADMIN ====================

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super Admin login' })
  adminLogin(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.adminLogin(dto, req.ip);
  }

  // ==================== CLIENT ====================

  @Public()
  @Post('client/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new lottery operator (client)' })
  registerClient(@Body() dto: RegisterClientDto) {
    return this.authService.registerClient(dto);
  }

  @Public()
  @Post('client/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Client (operator) login' })
  clientLogin(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.clientLogin(dto, req.ip);
  }

  // ==================== TOKENS ====================

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  refreshTokens(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  // ==================== PASSWORD ====================

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password (authenticated)' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, user.role, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // ==================== BUYER ====================

  @Public()
  @Post('buyer/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new buyer' })
  registerBuyer(@Body() dto: RegisterBuyerDto) {
    return this.buyersService.createBuyerWithAuth(dto);
  }

  @Public()
  @Post('buyer/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyer login' })
  buyerLogin(@Body() dto: BuyerLoginDto, @Req() req: Request) {
    return this.authService.buyerLogin(dto, dto.clientId, req.ip);
  }

  @UseGuards(JwtAuthGuard)
  @Get('buyer/me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current buyer profile' })
  buyerMe(@CurrentUser() user: AuthenticatedUser) {
    return this.buyersService.getBuyerById(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('buyer/profile')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update buyer profile' })
  updateBuyerProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBuyerProfileDto,
  ) {
    return this.buyersService.updateProfile(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('buyer/change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyer change password' })
  buyerChangePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BuyerChangePasswordDto,
  ) {
    return this.authService.changeBuyerPassword(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('buyer/tickets')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get buyer tickets' })
  buyerTickets(@CurrentUser() user: AuthenticatedUser) {
    return this.buyersService.getBuyerTickets(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('buyer/payments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get buyer payments' })
  buyerPayments(@CurrentUser() user: AuthenticatedUser) {
    return this.buyersService.getBuyerPayments(user.id);
  }
}
