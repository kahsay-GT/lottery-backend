import {
  Body, Controller, Delete, Get, Param, Query,
  Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UpdateClientProfileDto } from './dto/update-client.dto';

@ApiTags('Clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('me/logo')
  @ApiOperation({ summary: 'Upload operator logo/avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.clientsService.uploadLogo(user.id, file);
  }

  // ─── PUBLIC: list all active operators ──────────────────────────────
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'List all active lottery operators (public)' })
  listPublicOperators(
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
    @Query('search') search?: string,
  ) {
    return this.clientsService.listPublicOperators({
      page:   page  ? parseInt(page,  10) : undefined,
      limit:  limit ? parseInt(limit, 10) : undefined,
      search: search || undefined,
    });
  }

  // ─── PUBLIC: lottery bank accounts for buyers ───────────────────────
  @Public()
  @Get(':clientId/bank-accounts/public')
  @ApiOperation({ summary: "Get a client's bank accounts (public – for buyers to know where to pay)" })
  getPublicBankAccounts(@Param('clientId') clientId: string) {
    return this.clientsService.getBankAccounts(clientId);
  }

  // ─── PUBLIC: get operator public profile by username ────────────────
  @Public()
  @Get('by-username/:username')
  @ApiOperation({ summary: 'Get public operator profile by username' })
  getByUsername(@Param('username') username: string) {
    return this.clientsService.getPublicProfile(username);
  }

  // ─── OPERATOR: view payment slip inline to verify ───────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.SUPER_ADMIN, ROLES.STAFF)
  @Get('payments/:paymentId/slip')
  @ApiOperation({ summary: 'View payment slip inline (operator / staff / admin verification)' })
  async viewSlip(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const clientId =
      user.role === ROLES.SUPER_ADMIN ? undefined :
      user.role === ROLES.STAFF       ? user.clientId :
                                        user.id;
    const { buffer, mimeType, fileName } = await this.clientsService.getPaymentSlip(
      paymentId,
      clientId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buffer);
  }

  // ─── CLIENT profile ─────────────────────────────────────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('me')
  @ApiOperation({ summary: 'Get my profile' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.getMe(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch('me')
  @ApiOperation({ summary: 'Update my profile' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateClientProfileDto,
  ) {
    return this.clientsService.updateMe(user.id, dto);
  }

  // ─── BANK ACCOUNTS ──────────────────────────────────────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Get('bank-accounts')
  @ApiOperation({ summary: 'Get my bank accounts' })
  getBankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.getBankAccounts(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('bank-accounts')
  @ApiOperation({ summary: 'Add a bank account' })
  addBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: {
      bankName: string;
      accountName: string;
      accountNumber: string;
      branchName?: string;
      isDefault?: boolean;
    },
  ) {
    return this.clientsService.addBankAccount(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Delete('bank-accounts/:id')
  @ApiOperation({ summary: 'Remove a bank account' })
  deleteBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.clientsService.deleteBankAccount(user.id, id);
  }
}
