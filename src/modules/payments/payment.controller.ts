import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { PaymentService } from './payment.service';
import { FileService } from '../files/file.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ROLES } from '../../common/constants';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  InitiatePaymentDto,
  InitiateSubscriptionPaymentDto,
  RejectPaymentDto,
  RefundPaymentDto,
  ReviewPaymentDto,
  DeletePaymentDto,
} from './dto/payment.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly fileService: FileService,
  ) {}

  // ==================== PUBLIC ====================

  @Public()
  @Post('initiate')
  @ApiOperation({ summary: 'Initiate a ticket payment (guest/buyer)' })
  initiatePayment(@Body() dto: InitiatePaymentDto) {
    return this.paymentService.initiatePayment(dto);
  }

  @Public()
  @Post(':id/slip')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload payment slip (PDF/JPG/PNG max 5MB)' })
  async uploadSlip(
    @Param('id') paymentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const saved = await this.fileService.uploadFile(file, 'payment-slips');
    return this.paymentService.uploadPaymentSlip(paymentId, saved.id);
  }

  @Public()
  @Get('reference/:code')
  @ApiOperation({ summary: 'Track payment by reference code (guest)' })
  getByReference(@Param('code') code: string) {
    return this.paymentService.getPaymentByReference(code);
  }

  // ==================== BUYER ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.BUYER)
  @Get('my-payments')
  @ApiOperation({ summary: 'Get my payment history (buyer)' })
  myPayments(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.paymentService.getBuyerPayments(user.id, query);
  }

  // ==================== CLIENT / STAFF ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Get()
  @ApiOperation({ summary: 'List payments for my lotteries (client/staff)' })
  getClientPayments(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    return this.paymentService.getClientPayments(clientId, query);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Get('import/template')
  @ApiOperation({ summary: 'Download pre-filled import template (.xlsx) for pending payments' })
  async downloadImportTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Query('lotteryId') lotteryId: string | undefined,
    @Res() res: Response,
  ) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const buffer   = await this.paymentService.generateImportTemplate(clientId, lotteryId);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="payments-import-${Date.now()}.xlsx"`,
      'Content-Length':      buffer.length,
    });
    res.send(buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Bulk approve/reject payments by uploading a filled import template (.xlsx)' })
  async importPayments(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const clientId   = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const reviewerId = user.id;
    return this.paymentService.importPayments(file.buffer, clientId, reviewerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Get('bulk-import/template')
  @ApiOperation({ summary: 'Download blank bulk buyer import template (.xlsx)' })
  async downloadBulkImportTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const buffer   = await this.paymentService.generateBulkImportTemplate(clientId);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bulk-import-template.xlsx"`,
      'Content-Length':      buffer.length,
    });
    res.send(buffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Bulk import buyers — create payments and generate reference codes' })
  async processBulkImport(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const clientId   = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const reviewerId = user.id;
    const result = await this.paymentService.processBulkImport(file.buffer, clientId, reviewerId);
    res.set({
      'Content-Type':                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':           `attachment; filename="bulk-import-result-${Date.now()}.xlsx"`,
      'X-Import-Summary':              JSON.stringify({ imported: result.imported, skipped: result.skipped, errors: result.errors }),
      'Access-Control-Expose-Headers': 'X-Import-Summary',
    });
    res.send(result.resultBuffer);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Post('bulk-import/json')
  @ApiOperation({ summary: 'Bulk import buyers via JSON — browser-friendly alternative to the xlsx upload' })
  async processBulkImportJson(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { lotteryId: string; buyers: Array<{ name: string; phone: string; email?: string; quantity: number }> },
  ) {
    const clientId   = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const reviewerId = user.id;
    return this.paymentService.processBulkImportJson(body.lotteryId, body.buyers, clientId, reviewerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Get(':id')
  @ApiOperation({ summary: 'Get payment details (client/staff)' })
  getPayment(@Param('id') id: string) {
    return this.paymentService.getPayment(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Patch(':id/review')
  @ApiOperation({ summary: 'Mark payment as under review (client/staff)' })
  markUnderReview(@Param('id') id: string) {
    return this.paymentService.markUnderReview(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve payment (client or staff APPROVER)' })
  approvePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewPaymentDto,
  ) {
    // Staff with VIEWER role cannot approve
    if (user.role === ROLES.STAFF && user.staffRole !== 'APPROVER') {
      throw new Error('Staff VIEWER role cannot approve payments');
    }
    const reviewerId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const staffId    = user.role === ROLES.STAFF ? user.id : undefined;
    return this.paymentService.approvePayment(id, reviewerId, dto, staffId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject payment (client or staff APPROVER)' })
  rejectPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    if (user.role === ROLES.STAFF && user.staffRole !== 'APPROVER') {
      throw new Error('Staff VIEWER role cannot reject payments');
    }
    const reviewerId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    const staffId    = user.role === ROLES.STAFF ? user.id : undefined;
    return this.paymentService.rejectPayment(id, reviewerId, dto, staffId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Patch(':id/refund')
  @ApiOperation({ summary: 'Refund a payment (client)' })
  refundPayment(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.paymentService.refundPayment(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a payment with a reason (client/staff)' })
  softDeletePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeletePaymentDto,
  ) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    return this.paymentService.softDeletePayment(id, clientId, dto.reason);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT, ROLES.STAFF)
  @Patch(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted payment (client/staff)' })
  restorePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const clientId = user.role === ROLES.STAFF ? user.clientId! : user.id;
    return this.paymentService.restorePayment(id, clientId);
  }

  // ==================== SUBSCRIPTION PAYMENTS ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('subscriptions/initiate')
  @ApiOperation({ summary: 'Initiate subscription payment (client)' })
  initiateSubscriptionPayment(
    @Body() dto: InitiateSubscriptionPaymentDto,
  ) {
    return this.paymentService.initiateSubscriptionPayment(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.CLIENT)
  @Post('subscriptions/:id/slip')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload subscription payment slip (client)' })
  async uploadSubscriptionSlip(
    @Param('id') transactionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const saved = await this.fileService.uploadFile(file, 'subscription-slips');
    return this.paymentService.uploadSubscriptionSlip(transactionId, saved.id);
  }

  // ==================== ADMIN ====================

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('admin/all')
  @ApiOperation({ summary: 'List all payments (admin)' })
  getAllPayments(@Query() query: PaginationDto) {
    return this.paymentService.getAllPayments(query);
  }

  // ── Slip viewer for client/admin ─────────────────────────────────
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get('subscription-slip/:id')
  @ApiOperation({ summary: 'View subscription payment slip (admin)' })
  async viewSubscriptionSlip(@Param('id') txnId: string, @Res() res: Response) {
    const txn = await this.paymentService.getSubscriptionTxnWithSlip(txnId);
    const slips = txn.slips as Array<{ file: { id: string } }>;
    if (!slips?.length) {
      res.status(404).json({ message: 'No slip uploaded for this transaction' });
      return;
    }
    const fileId = slips[slips.length - 1].file.id;
    const { buffer, file } = await this.fileService.getFileBuffer(fileId);
    res.set({
      'Content-Type': file!.mimeType,
      'Content-Disposition': `inline; filename="${file!.originalName}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}
