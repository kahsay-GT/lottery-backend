import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import { FileService } from '../files/file.service';
import { SlipVerifyService } from '../slip-verify/slip-verify.service';
import { EventsGateway } from '../events/events.gateway';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  buildPaginatedResult,
  getPrismaSkipTake,
} from '../../common/interfaces/pagination.interface';
import {
  InitiatePaymentDto,
  InitiateSubscriptionPaymentDto,
  RejectPaymentDto,
  RefundPaymentDto,
  ReviewPaymentDto,
} from './dto/payment.dto';
import { generateReferenceCode } from '../../common/utils/slug.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketService: TicketService,
    private readonly fileService: FileService,
    private readonly slipVerify: SlipVerifyService,
    private readonly events: EventsGateway,
  ) {}

  // ==================== TICKET PAYMENTS ====================

  async initiatePayment(dto: InitiatePaymentDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.paymentTransaction.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }

    const reservation = await this.prisma.ticketReservation.findUnique({
      where: { id: dto.reservationId },
      include: { lottery: true, tickets: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.cancelledAt) throw new BadRequestException('Reservation has been cancelled');

    const lottery = reservation.lottery;
    const amount = Number(lottery.ticketPrice) * reservation.quantity;

    const buyerEmail = dto.buyerEmail || null;

    // Look up existing buyer: by email if provided, otherwise by phone
    let buyer = buyerEmail
      ? await this.prisma.buyer.findFirst({
          where: { clientId: lottery.clientId, email: buyerEmail },
        })
      : await this.prisma.buyer.findFirst({
          where: { clientId: lottery.clientId, phone: dto.buyerPhone, email: null },
        });

    if (!buyer) {
      buyer = await this.prisma.buyer.create({
        data: {
          clientId: lottery.clientId,
          email: buyerEmail,
          name: dto.buyerName,
          phone: dto.buyerPhone,
          isGuest: true,
        },
      });
    }

    const payment = await this.prisma.paymentTransaction.create({
      data: {
        clientId: lottery.clientId,
        lotteryId: dto.lotteryId,
        buyerId: buyer.id,
        amount,
        status: 'INITIATED',
        provider: 'MANUAL_BANK_TRANSFER',
        referenceCode: generateReferenceCode(),
        idempotencyKey: dto.idempotencyKey,
      },
    });

    await this.ticketService.confirmReservation(dto.reservationId, payment.id);
    this.logger.log(`Payment ${payment.id} initiated for reservation ${dto.reservationId}`);
    return payment;
  }

  async uploadPaymentSlip(paymentId: string, fileId: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { lottery: { select: { name: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    // Treat any already-processed state as idempotent success — this handles double-clicks,
    // page-refresh retries, and the race where async verification approves the payment
    // before a second upload attempt arrives.
    if (['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(payment.status)) {
      return {
        message:
          payment.status === 'APPROVED'
            ? 'Payment has already been approved.'
            : 'Payment slip already submitted and is under review.',
        paymentId,
        referenceCode: payment.referenceCode,
        status: payment.status,
      };
    }
    if (payment.status !== 'INITIATED') {
      throw new BadRequestException('Payment cannot accept a slip in its current state');
    }

    // ── Synchronous duplicate-slip check ─────────────────────────────────────
    // Compute the hash of the uploaded file and check whether any *other*
    // payment transaction (SUBMITTED / UNDER_REVIEW / APPROVED) already has a
    // slip with the same content.  This fires before the async OCR pipeline so
    // there is no timing window to exploit.
    const contentHash = await this.fileService.getContentHash(fileId);
    if (contentHash) {
      const duplicateSlip = await this.prisma.paymentSlip.findFirst({
        where: {
          file: { contentHash },
          paymentTransactionId: { not: paymentId },
          paymentTransaction: {
            status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
          },
        },
        select: { paymentTransactionId: true },
      });
      if (duplicateSlip) {
        throw new ConflictException(
          'This payment slip has already been used for another payment. Please upload a different slip.',
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { buffer, file } = await this.fileService.getFileBuffer(fileId);

    // ── Quick QR scan (fast, synchronous — no OCR) ────────────────────────────
    // Decode any QR code in the slip image right now so the receipt URL is
    // stored on the PaymentSlip row immediately, visible to reviewers before
    // the async OCR + verification pipeline completes.
    const slipReceiptUrl = await this.slipVerify.quickScanQR(
      buffer,
      file?.mimeType ?? 'image/jpeg',
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentSlip.create({
        data: {
          paymentTransactionId: paymentId,
          fileId,
          ...(slipReceiptUrl ? { receiptUrl: slipReceiptUrl } : {}),
        },
      });
      await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { status: 'SUBMITTED' },
      });
    });

    // Emit slip-uploaded event
    this.events.emitPaymentUpdate(payment.clientId, {
      paymentId: payment.id,
      referenceCode: payment.referenceCode,
      status: 'SUBMITTED',
      amount: Number(payment.amount),
      currency: payment.currency,
      lotteryName: (payment as any).lottery?.name,
      updatedAt: new Date().toISOString(),
    });

    // Async verification
    this.runSlipVerification(
      buffer,
      file?.mimeType ?? 'image/jpeg',
      paymentId,
      Number(payment.amount),
      payment.clientId,
    ).catch((err) =>
      this.logger.error(`Slip verification error for payment ${paymentId}: ${err?.message}`),
    );

    return {
      message: 'Payment slip uploaded. Verification is in progress.',
      paymentId,
      status: 'SUBMITTED',
    };
  }

  async uploadSubscriptionSlip(transactionId: string, fileId: string) {
    const tx = await this.prisma.subscriptionTransaction.findUnique({
      where: { id: transactionId },
      include: { subscription: { include: { plan: true, client: { select: { id: true } } } } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.status !== 'INITIATED') {
      throw new BadRequestException(
        tx.status === 'SUBMITTED' || tx.status === 'UNDER_REVIEW'
          ? 'A slip has already been submitted for this transaction and is under review'
          : 'Transaction cannot accept a slip in its current state',
      );
    }

    // ── Synchronous duplicate-slip check ─────────────────────────────────────
    const contentHash = await this.fileService.getContentHash(fileId);
    if (contentHash) {
      const duplicateSlip = await this.prisma.paymentSlip.findFirst({
        where: {
          file: { contentHash },
          subscriptionTransactionId: { not: transactionId },
          subscriptionTransaction: {
            status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] },
          },
        },
        select: { subscriptionTransactionId: true },
      });
      if (duplicateSlip) {
        throw new ConflictException(
          'This payment slip has already been used for another subscription payment. Please upload a different slip.',
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { buffer, file } = await this.fileService.getFileBuffer(fileId);
    const clientId = tx.subscription?.client?.id ?? tx.subscription?.clientId ?? '';

    // ── Quick QR scan ─────────────────────────────────────────────────────────
    const slipReceiptUrl = await this.slipVerify.quickScanQR(
      buffer,
      file?.mimeType ?? 'image/jpeg',
    );

    await this.prisma.$transaction(async (p) => {
      await p.paymentSlip.create({
        data: {
          subscriptionTransactionId: transactionId,
          fileId,
          ...(slipReceiptUrl ? { receiptUrl: slipReceiptUrl } : {}),
        },
      });
      await p.subscriptionTransaction.update({
        where: { id: transactionId },
        data: { status: 'SUBMITTED' },
      });
      await p.subscription.update({
        where: { id: tx.subscriptionId },
        data: { status: 'UNDER_REVIEW' },
      });
    });

    // Emit slip-uploaded event
    this.events.emitSubscriptionUpdate(clientId, {
      transactionId,
      subscriptionId: tx.subscriptionId,
      status: 'SUBMITTED',
      planName: tx.subscription?.plan?.name,
      updatedAt: new Date().toISOString(),
    });

    this.runSubscriptionSlipVerification(
      buffer,
      file?.mimeType ?? 'image/jpeg',
      transactionId,
      Number(tx.amount),
      clientId,
    ).catch((err) =>
      this.logger.error(`Sub slip verification error for txn ${transactionId}: ${err?.message}`),
    );

    return {
      message: 'Subscription payment slip uploaded. Verification is in progress.',
      transactionId,
      status: 'SUBMITTED',
    };
  }

  // ─── Slip verification — ticket payment ────────────────────────────────────

  private async runSlipVerification(
    buffer: Buffer,
    mimeType: string,
    paymentId: string,
    expectedAmount: number,
    clientId: string,
  ): Promise<void> {
    this.logger.log(`Running slip verification for ticket payment ${paymentId}`);

    const result = await this.slipVerify.verifySlip(
      buffer,
      mimeType,
      paymentId,
      expectedAmount,
      clientId,
    );

    this.logger.log(
      `Verification result for ${paymentId}: status=${result.status} autoApprove=${result.autoApprove}`,
    );

    const metadataUpdate: Prisma.InputJsonValue = {
      verificationStatus: result.status,
      verificationReason: result.reason,
      verifiedAt: new Date().toISOString(),
      provider: result.extractedData.provider,
      ...(result.extractedData.transactionRef
        ? { verifiedTransactionRef: result.extractedData.transactionRef }
        : {}),
      // Store the receipt URL so duplicate receipt-URL submissions are rejected
      ...(result.extractedData.receiptUrl
        ? { verifiedReceiptUrl: result.extractedData.receiptUrl }
        : {}),
      ...(result.extractedData.amount !== null
        ? { detectedAmount: result.extractedData.amount ?? 0 }
        : {}),
    };

    // Fetch referenceCode for events
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { lottery: { select: { name: true } }, tickets: { select: { ticketNumber: true } } },
    });

    const baseEvent = {
      paymentId,
      referenceCode: payment?.referenceCode ?? '',
      amount: Number(payment?.amount ?? 0),
      currency: payment?.currency ?? 'ETB',
      lotteryName: (payment as any)?.lottery?.name,
      verificationStatus: result.status,
      verificationReason: result.reason,
      updatedAt: new Date().toISOString(),
    };

    if (result.status === 'DUPLICATE') {
      await this.prisma.paymentTransaction.update({
        where: { id: paymentId },
        data: { status: 'REJECTED', rejectionReason: result.reason, metadata: metadataUpdate },
      });
      this.events.emitPaymentUpdate(clientId, {
        ...baseEvent, status: 'REJECTED', rejectionReason: result.reason,
      });
      this.logger.warn(`Payment ${paymentId} rejected as DUPLICATE`);
      return;
    }

    if (result.status === 'FAILED') {
      await this.prisma.paymentTransaction.update({
        where: { id: paymentId },
        data: { status: 'REJECTED', rejectionReason: result.reason, metadata: metadataUpdate },
      });
      this.events.emitPaymentUpdate(clientId, {
        ...baseEvent, status: 'REJECTED', rejectionReason: result.reason,
      });
      this.logger.warn(`Payment ${paymentId} verification FAILED`);
      return;
    }

    if (result.autoApprove) {
      await this.prisma.paymentTransaction.update({
        where: { id: paymentId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          reviewedAt: new Date(),
          notes: result.reason,
          metadata: metadataUpdate,
        },
      });

      try {
        await this.ticketService.finalizeTickets(paymentId);
        this.logger.log(`Payment ${paymentId} AUTO-APPROVED and tickets finalized`);
      } catch (e) {
        this.logger.error(`finalizeTickets failed for ${paymentId}: ${(e as Error).message}`);
      }

      // Re-fetch tickets for the event
      const finalized = await this.prisma.paymentTransaction.findUnique({
        where: { id: paymentId },
        include: { tickets: { select: { ticketNumber: true } } },
      });

      this.events.emitPaymentUpdate(clientId, {
        ...baseEvent,
        status: 'APPROVED',
        autoApproved: true,
        tickets: finalized?.tickets?.map((t) => t.ticketNumber) ?? [],
      });
      return;
    }

    // PENDING_MANUAL → UNDER_REVIEW
    await this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: { status: 'UNDER_REVIEW', metadata: metadataUpdate },
    });
    this.events.emitPaymentUpdate(clientId, { ...baseEvent, status: 'UNDER_REVIEW' });
    this.logger.log(`Payment ${paymentId} → UNDER_REVIEW`);
  }

  // ─── Slip verification — subscription payment ──────────────────────────────

  private async runSubscriptionSlipVerification(
    buffer: Buffer,
    mimeType: string,
    transactionId: string,
    expectedAmount: number,
    clientId: string,
  ): Promise<void> {
    this.logger.log(`Running slip verification for subscription txn ${transactionId}`);

    const result = await this.slipVerify.verifySlip(
      buffer,
      mimeType,
      transactionId,
      expectedAmount,
      clientId,
    );

    const metadataUpdate: Prisma.InputJsonValue = {
      verificationStatus: result.status,
      verificationReason: result.reason,
      verifiedAt: new Date().toISOString(),
      provider: result.extractedData.provider,
      ...(result.extractedData.transactionRef
        ? { verifiedTransactionRef: result.extractedData.transactionRef }
        : {}),
      // Store the receipt URL so duplicate receipt-URL submissions are rejected
      ...(result.extractedData.receiptUrl
        ? { verifiedReceiptUrl: result.extractedData.receiptUrl }
        : {}),
    };

    const txRecord = await this.prisma.subscriptionTransaction.findUnique({
      where: { id: transactionId },
      include: { subscription: { include: { plan: { select: { name: true } } } } },
    });

    const baseSubEvent = {
      transactionId,
      subscriptionId: txRecord?.subscriptionId ?? '',
      planName: (txRecord as any)?.subscription?.plan?.name,
      verificationStatus: result.status,
      verificationReason: result.reason,
      updatedAt: new Date().toISOString(),
    };

    if (result.status === 'DUPLICATE' || result.status === 'FAILED') {
      await this.prisma.$transaction(async (p) => {
        const updated = await p.subscriptionTransaction.update({
          where: { id: transactionId },
          data: { status: 'REJECTED', metadata: metadataUpdate, notes: result.reason },
        });
        await p.subscription.update({
          where: { id: updated.subscriptionId },
          data: { status: 'CANCELLED' },
        });
      });
      this.events.emitSubscriptionUpdate(clientId, { ...baseSubEvent, status: 'REJECTED' });
      this.events.emitNotification(clientId, {
        title: 'Subscription Payment Rejected',
        message: result.reason,
        type: 'error',
      });
      return;
    }

    if (result.autoApprove) {
      await this.prisma.$transaction(async (p) => {
        const updated = await p.subscriptionTransaction.update({
          where: { id: transactionId },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
            paidAt: new Date(),
            metadata: metadataUpdate,
            notes: result.reason,
          },
        });
        await p.subscription.update({
          where: { id: updated.subscriptionId },
          data: { status: 'ACTIVE', startsAt: new Date() },
        });
      });
      this.events.emitSubscriptionUpdate(clientId, {
        ...baseSubEvent, status: 'APPROVED', autoApproved: true,
      });
      this.events.emitNotification(clientId, {
        title: 'Subscription Activated!',
        message: `Your ${baseSubEvent.planName ?? ''} plan is now active. You can create lotteries.`,
        type: 'success',
      });
      this.logger.log(`Subscription txn ${transactionId} AUTO-APPROVED`);
      return;
    }

    await this.prisma.subscriptionTransaction.update({
      where: { id: transactionId },
      data: { status: 'UNDER_REVIEW', metadata: metadataUpdate, notes: result.reason },
    });
    this.events.emitSubscriptionUpdate(clientId, { ...baseSubEvent, status: 'UNDER_REVIEW' });
  }

  // ==================== MANUAL REVIEW ACTIONS ====================

  async approvePayment(
    paymentId: string,
    reviewerId: string,
    dto: ReviewPaymentDto,
    staffId?: string,
  ) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { lottery: { select: { name: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!['INITIATED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED'].includes(payment.status)) {
      throw new BadRequestException('Payment is not awaiting approval');
    }

    await this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        approvedAt: new Date(),
        notes: dto.notes,
        ...(staffId ? { approvedByStaffId: staffId } : {}),
      },
    });

    await this.ticketService.finalizeTickets(paymentId);

    const finalized = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { tickets: { select: { ticketNumber: true } } },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        clientId: payment.clientId,
        entityType: 'PaymentTransaction',
        entityId: paymentId,
        action: 'APPROVE',
        newValue: {
          paymentId,
          referenceCode: payment.referenceCode,
          approvedBy: staffId ? `staff:${staffId}` : `client:${reviewerId}`,
          notes: dto.notes ?? null,
        },
      },
    });

    this.events.emitPaymentUpdate(payment.clientId, {
      paymentId,
      referenceCode: payment.referenceCode,
      status: 'APPROVED',
      amount: Number(payment.amount),
      currency: payment.currency,
      lotteryName: (payment as any).lottery?.name,
      tickets: finalized?.tickets?.map((t) => t.ticketNumber) ?? [],
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`Payment ${paymentId} approved by ${staffId ? 'staff:' + staffId : 'client:' + reviewerId}`);
    return { message: 'Payment approved and tickets assigned' };
  }

  async rejectPayment(
    paymentId: string,
    reviewerId: string,
    dto: RejectPaymentDto,
    staffId?: string,
  ) {
    const payment = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!['INITIATED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(payment.status)) {
      throw new BadRequestException('Payment cannot be rejected in current state');
    }

    await this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        status: 'REJECTED',
        rejectionReason: dto.reason,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        ...(staffId ? { rejectedByStaffId: staffId } : {}),
      },
    });

    await this.prisma.lotteryTicket.updateMany({
      where: { paymentId, status: { in: ['PENDING_PAYMENT', 'SOLD'] } },
      data: { status: 'AVAILABLE', paymentId: null, reservationId: null, buyerId: null, purchasedAt: null, assignedAt: null },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        clientId: payment.clientId,
        entityType: 'PaymentTransaction',
        entityId: paymentId,
        action: 'REJECT',
        newValue: {
          paymentId,
          referenceCode: payment.referenceCode,
          rejectedBy: staffId ? `staff:${staffId}` : `client:${reviewerId}`,
          reason: dto.reason,
        },
      },
    });

    this.events.emitPaymentUpdate(payment.clientId, {
      paymentId,
      referenceCode: payment.referenceCode,
      status: 'REJECTED',
      amount: Number(payment.amount),
      currency: payment.currency,
      rejectionReason: dto.reason,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`Payment ${paymentId} rejected by ${staffId ? 'staff:' + staffId : 'client:' + reviewerId}`);
    return { message: 'Payment rejected and tickets released' };
  }

  async refundPayment(paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'APPROVED') {
      throw new BadRequestException('Only approved payments can be refunded');
    }

    await this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundReason: dto.reason },
    });

    this.events.emitPaymentUpdate(payment.clientId, {
      paymentId,
      referenceCode: payment.referenceCode,
      status: 'REFUNDED',
      amount: Number(payment.amount),
      currency: payment.currency,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`Payment ${paymentId} refunded`);
    return { message: 'Payment refunded' };
  }

  async markUnderReview(paymentId: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!['INITIATED', 'SUBMITTED', 'REJECTED'].includes(payment.status)) {
      throw new BadRequestException('Payment cannot be marked under review in its current state');
    }
    const updated = await this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: { status: 'UNDER_REVIEW' },
    });

    this.events.emitPaymentUpdate(payment.clientId, {
      paymentId,
      referenceCode: payment.referenceCode,
      status: 'UNDER_REVIEW',
      amount: Number(payment.amount),
      currency: payment.currency,
      updatedAt: new Date().toISOString(),
    });

    return updated;
  }

  // ==================== SUBSCRIPTION PAYMENTS ====================

  async initiateSubscriptionPayment(dto: InitiateSubscriptionPaymentDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: dto.subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const tx = await this.prisma.subscriptionTransaction.create({
      data: {
        subscriptionId: dto.subscriptionId,
        amount: subscription.price,
        status: 'INITIATED',
        referenceCode: generateReferenceCode(),
      },
    });

    await this.prisma.subscription.update({
      where: { id: dto.subscriptionId },
      data: { status: 'AWAITING_PAYMENT' },
    });

    return tx;
  }

  // ==================== QUERIES ====================

  async getClientPayments(clientId: string, query: PaginationDto) {
    const { page = 1, limit = 20, lotteryId, includeDeleted } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const where = {
      clientId,
      // When includeDeleted=true show all; otherwise hide soft-deleted rows
      ...(includeDeleted !== 'true' ? { deletedAt: null } : {}),
      ...(lotteryId ? { lotteryId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where, skip, take,
        include: {
          buyer: { select: { id: true, name: true, email: true, phone: true } },
          lottery: { select: { id: true, name: true } },
          slips: { include: { file: true } },
          approvedByStaff: { select: { id: true, name: true, email: true } },
          rejectedByStaff: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getPayment(id: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id },
      include: {
        buyer: true,
        lottery: { select: { id: true, name: true } },
        tickets: { select: { id: true, ticketNumber: true } },
        slips: { include: { file: true } },
        approvedByStaff: { select: { id: true, name: true, email: true } },
        rejectedByStaff: { select: { id: true, name: true, email: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async getSubscriptionTxnWithSlip(id: string) {
    const txn = await this.prisma.subscriptionTransaction.findUnique({
      where: { id },
      include: { slips: { include: { file: true } } },
    });
    if (!txn) throw new NotFoundException('Subscription transaction not found');
    return txn;
  }

  async getPaymentByReference(referenceCode: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { referenceCode },
      include: {
        lottery: { select: { id: true, name: true, slug: true } },
        tickets: { select: { ticketNumber: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async getBuyerPayments(buyerId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: { buyerId, deletedAt: null }, skip, take,
        include: {
          lottery: { select: { id: true, name: true, slug: true } },
          tickets: { select: { ticketNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where: { buyerId, deletedAt: null } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  async getAllPayments(query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const { skip, take } = getPrismaSkipTake(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: { deletedAt: null },
        skip, take,
        include: {
          buyer: { select: { id: true, name: true, email: true, phone: true } },
          lottery: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paymentTransaction.count({ where: { deletedAt: null } }),
    ]);
    return buildPaginatedResult(data, total, page, limit);
  }

  // ==================== SOFT DELETE / RESTORE ====================

  async softDeletePayment(paymentId: string, clientId: string, reason: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.clientId !== clientId) throw new NotFoundException('Payment not found');
    if (payment.deletedAt) throw new BadRequestException('Payment is already deleted');
    if (payment.status === 'APPROVED') {
      throw new BadRequestException(
        'An approved payment cannot be deleted. Reverse the approval first.',
      );
    }

    return this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        deletedAt:    new Date(),
        deleteReason: reason.trim(),
      },
      select: {
        id: true, status: true, deletedAt: true, deleteReason: true,
      },
    });
  }

  async restorePayment(paymentId: string, clientId: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.clientId !== clientId) throw new NotFoundException('Payment not found');
    if (!payment.deletedAt) throw new BadRequestException('Payment is not deleted');

    return this.prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        deletedAt:    null,
        deleteReason: null,
      },
      select: {
        id: true, status: true, deletedAt: true, deleteReason: true,
      },
    });
  }

  // ==================== EXCEL IMPORT ====================

  /**
   * Generate a downloadable import template (.xlsx) pre-filled with
   * the client's current SUBMITTED / UNDER_REVIEW payments.
   * When lotteryId is provided, only payments for that lottery are included.
   *
   * Columns: Buyer Name | Phone | Email | Ticket Numbers | Qty | Amount | Current Status | Status | Notes
   * Reference Code and Lottery Name are intentionally omitted — the backend identifies
   * payments by its internal ID (looked up via phone or an internal hidden ref).
   */
  async generateImportTemplate(clientId: string, lotteryId?: string): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lottery SaaS';

    // Fetch active payments — optionally filtered by lottery
    // Includes INITIATED so operator can approve even without a slip upload
    const payments = await this.prisma.paymentTransaction.findMany({
      where: {
        clientId,
        status: { in: ['INITIATED', 'SUBMITTED', 'UNDER_REVIEW'] },
        deletedAt: null,
        ...(lotteryId ? { lotteryId } : {}),
      },
      include: {
        buyer:   { select: { name: true, email: true, phone: true } },
        lottery: { select: { name: true } },
        tickets: { select: { ticketNumber: true }, orderBy: { ticketNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Derive lottery name for the sheet title (when filtered to one lottery)
    const lotteryName = lotteryId && payments.length > 0
      ? ((payments[0].lottery as any)?.name ?? 'Payments')
      : 'All Lotteries';

    const sheet = workbook.addWorksheet('Payments Import');

    // ── Column definitions ─────────────────────────────────────────────────
    // REQUIRED (always visible, marked with *):
    //   Buyer Name | Phone Number | Ticket Numbers | Qty | Amount | Status
    // OPTIONAL (hidden by default — still parsed on upload if present):
    //   Email | Current Status | Notes
    sheet.columns = [
      { header: 'Buyer Name *',          key: 'buyerName', width: 28 },
      { header: 'Phone Number *',        key: 'phone',     width: 20 },
      { header: 'Ticket Numbers *',      key: 'tickets',   width: 36 },
      { header: 'Qty *',                 key: 'qty',       width:  8 },
      { header: 'Amount (ETB) *',        key: 'amount',    width: 16 },
      { header: 'Status *',              key: 'action',    width: 16 },
      { header: 'Email',                 key: 'email',     width:  0 },  // hidden
      { header: 'Current Status',        key: 'curStatus', width:  0 },  // hidden
      { header: 'Notes / Reject Reason', key: 'notes',     width:  0 },  // hidden
    ];

    // Hide optional columns so the sheet opens clean
    sheet.getColumn('email').hidden     = true;
    sheet.getColumn('curStatus').hidden = true;
    sheet.getColumn('notes').hidden     = true;

    // ── Header style ───────────────────────────────────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.height    = 24;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    // Required columns — deep indigo bold
    ['buyerName','phone','tickets','qty','amount','action'].forEach(k => {
      const cell = headerRow.getCell(sheet.getColumn(k).number);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
    });
    // Optional (hidden) columns — grey
    ['email','curStatus','notes'].forEach(k => {
      const cell = headerRow.getCell(sheet.getColumn(k).number);
      cell.font = { bold: false, color: { argb: 'FF6B7280' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    });

    // ── Lottery label row (row 2) ──────────────────────────────────────────
    const labelRow = sheet.addRow({
      buyerName: `Lottery: ${lotteryName}`,
      phone:     '',
      tickets:   `${payments.length} payment(s)`,
      qty:       '',
      amount:    '',
      action:    '',
      email:     '',
      curStatus: '',
      notes:     'Do NOT edit this row',
    });
    labelRow.height = 16;
    labelRow.eachCell(cell => {
      cell.font       = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };
      cell.fill       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
      cell.protection = { locked: true };
    });

    // ── Populate payment rows (start at row 3) ─────────────────────────────
    payments.forEach((p, i) => {
      const ticketNums = p.tickets.map((t) => t.ticketNumber).join(', ');

      const row = sheet.addRow({
        buyerName: p.buyer?.name  ?? '—',
        phone:     p.buyer?.phone ?? '—',
        tickets:   ticketNums || '—',
        qty:       p.tickets.length,
        amount:    Number(p.amount).toFixed(2),
        action:    'PENDING',
        // hidden optional columns
        email:     p.buyer?.email ?? '',
        curStatus: p.status,
        notes:     '',
      });

      row.height = 20;

      // Zebra stripe on required visible columns only
      const bg = i % 2 === 0 ? 'FF0D1117' : 'FF111827';
      ['buyerName','phone','tickets','qty','amount'].forEach(k => {
        row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      });

      // Ticket numbers — emerald green
      row.getCell('tickets').font  = { color: { argb: 'FF34D399' } };
      row.getCell('amount').numFmt = '#,##0.00';

      // Editable Status dropdown
      const actionCell = row.getCell('action');
      (actionCell as any).dataValidation = {
        type:             'list',
        allowBlank:       false,
        formulae:         ['"APPROVED,PENDING"'],
        showErrorMessage: true,
        errorTitle:       'Invalid status',
        error:            'Choose APPROVED or PENDING',
        showInputMessage: true,
        promptTitle:      'Status',
        prompt:           'APPROVED = confirm & assign tickets  |  PENDING = no change',
      };
      actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

      // Lock read-only cells
      row.getCell('tickets').protection   = { locked: true };
      row.getCell('qty').protection       = { locked: true };
      row.getCell('curStatus').protection = { locked: true };
    });

    sheet.views      = [{ state: 'frozen', ySplit: 2 }];
    sheet.autoFilter = { from: 'A1', to: 'F1' };  // only over the 6 visible required columns

    // ── Instructions sheet ─────────────────────────────────────────────────
    const instr = workbook.addWorksheet('📋 Instructions');
    instr.getCell('A1').value = 'How to use this import template';
    instr.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF818CF8' } };
    [
      ['Step 1', 'Open the "Payments Import" sheet.'],
      ['Step 2', 'For each row, click the "Status *" cell and choose from the dropdown:'],
      ['',       '  • APPROVED — confirms the payment and assigns the listed tickets to the buyer'],
      ['',       '  • REJECTED — rejects the payment and releases those tickets back to the pool'],
      ['',       '  • PENDING  — leave this payment unchanged (default)'],
      ['Step 3', 'Save the file and upload via the "Import Excel" button on the Payments page.'],
      ['',       ''],
      ['Required', 'Buyer Name * | Phone Number * | Ticket Numbers * | Qty * | Amount * | Status *'],
      ['Hidden',   'Email, Current Status, Notes — hidden by default. Unhide from Excel if needed.'],
      ['Note 1',   'The backend matches each row to a payment using the Phone Number.'],
      ['Note 2',   'Reference Code and Lottery Name are not shown — managed by the backend.'],
      ['Note 3',   'Row 2 (grey) shows the lottery name — do not delete or edit it.'],
    ].forEach(([key, val], i) => {
      instr.getCell(`A${i + 3}`).value = key;
      instr.getCell(`B${i + 3}`).value = val;
      if (String(key).startsWith('Step'))    instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF34D399' } };
      if (String(key).startsWith('Note'))    instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FFFBBF24' } };
      if (String(key) === 'Required')        instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF818CF8' } };
      if (String(key) === 'Hidden')          instr.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF6B7280' } };
    });
    instr.getColumn('A').width = 12;
    instr.getColumn('B').width = 82;

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Parse an uploaded .xlsx file and bulk-approve / reject payments.
   * The new template does not include Reference Code or Lottery columns.
   * Matching is done exclusively by Phone number.
   * Returns a summary: { approved, rejected, skipped, errors, approvedTickets }.
   */
  async importPayments(
    fileBuffer: Buffer,
    clientId:   string,
    reviewerId: string,
  ): Promise<{
    approved: number;
    rejected: number;
    skipped:  number;
    errors:   Array<{ referenceCode: string; reason: string }>;
    approvedTickets: Array<{ referenceCode: string; buyerName: string; tickets: string[] }>;
  }> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer);

    const sheet =
      workbook.getWorksheet('Payments Import') ??
      workbook.worksheets[0];

    if (!sheet) throw new BadRequestException('No worksheet found in the uploaded file.');

    // ── Read header row (row 1) to map column positions ───────────────────
    const headerRow = sheet.getRow(1);
    const colIndex: Record<string, number> = {};

    // Collect all columns whose header contains "status" so we can pick the right one
    const statusCols: Array<{ col: number; header: string }> = [];

    headerRow.eachCell((cell, colNum) => {
      const raw = String(cell.value ?? '').trim();
      const val = raw.toLowerCase().replace(/[^a-z]/g, ''); // strip * and spaces

      if (val.includes('reference'))               colIndex['ref']     = colNum;
      if (val.includes('phone'))                   colIndex['phone']   = colNum;
      if (val.includes('notes') || val.includes('reason')) colIndex['notes'] = colNum;
      if (val.includes('buyer') || val === 'name') colIndex['name']    = colNum;
      if (val === 'qty' || val === 'quantity')     colIndex['qty']     = colNum;
      if (val.includes('ticket') && val.includes('number')) colIndex['tickets'] = colNum;
      if (val.includes('ticket') && !val.includes('number') && !val.includes('price')) colIndex['tickets'] = colIndex['tickets'] ?? colNum;

      // Track every column that contains "status"
      if (raw.toLowerCase().includes('status') || raw.toLowerCase() === 'action') {
        statusCols.push({ col: colNum, header: raw });
      }
    });

    // Pick the editable Status column:
    //   • Prefer the FIRST column whose stripped header is exactly "status"
    //     (e.g. "Status *" → stripped → "status" ✓)
    //   • "Current Status" stripped = "currentstatus" — never matches "status" exactly
    //   • Fallback: first status column (leftmost, which is the editable one in our template)
    const exactStatus = statusCols.find(c => c.header.toLowerCase().replace(/[^a-z]/g, '') === 'status');
    const actionCol   = exactStatus ?? statusCols[0]; // first = leftmost = editable Status col
    if (actionCol) colIndex['action'] = actionCol.col;

    if (!colIndex['action']) {
      throw new BadRequestException(
        'Invalid template: "Status" column not found. ' +
        'Download a fresh template from the Import button.',
      );
    }
    if (!colIndex['phone'] && !colIndex['ref']) {
      throw new BadRequestException(
        'Invalid template: "Phone" column is required to match payments.',
      );
    }

    // ── Parse data rows ────────────────────────────────────────────────────
    // Skip row 1 (headers) and any row whose phone cell starts with "Lottery:"
    // or is empty — this handles the optional lottery-label row (row 2) gracefully.
    type ImportRow = {
      referenceCode: string;
      phone:         string;
      buyerName:     string;
      action:        string;
      notes:         string;
      qty:           number;
      ticketNums:    string;
    };
    const rows: ImportRow[] = [];

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // always skip header

      const rawPhone = colIndex['phone']
        ? String(row.getCell(colIndex['phone']).value ?? '').trim()
        : '';

      // Skip the lottery-label row (its "name" cell starts with "Lottery:")
      const rawName  = colIndex['name']
        ? String(row.getCell(colIndex['name']).value ?? '').trim()
        : '';
      if (rawName.toLowerCase().startsWith('lottery:')) return;

      const ref        = colIndex['ref']     ? String(row.getCell(colIndex['ref']).value     ?? '').trim() : '';
      const phone      = rawPhone;
      const name       = rawName;
      const action     = String(row.getCell(colIndex['action']).value ?? '').trim().toUpperCase();
      const notes      = colIndex['notes']   ? String(row.getCell(colIndex['notes']).value   ?? '').trim() : '';
      const qtyRaw     = colIndex['qty']     ? String(row.getCell(colIndex['qty']).value     ?? '').trim() : '';
      const ticketNums = colIndex['tickets'] ? String(row.getCell(colIndex['tickets']).value ?? '').trim() : '';
      const qty        = parseInt(qtyRaw.replace(/[^0-9]/g, ''), 10) || 1;

      // Only collect rows marked APPROVED — skip everything else silently
      const hasIdentifier = ref || phone;
      if (hasIdentifier && action === 'APPROVED') {
        rows.push({ referenceCode: ref, phone, buyerName: name, action, notes, qty, ticketNums });
      }
    });

    if (rows.length === 0) {
      return { approved: 0, rejected: 0, skipped: 0, errors: [], approvedTickets: [] };
    }

    // ── Resolve lottery from the label row ─────────────────────────────────
    // Row 2 of the template contains "Lottery: <name>". Read it to identify
    // which lottery these payments belong to so we can create them if needed.
    let lotteryRecord: { id: string; name: string; ticketPrice: any; clientId: string } | null = null;

    const labelRow2 = sheet.getRow(2);
    const labelCell  = colIndex['name'] ? String(labelRow2.getCell(colIndex['name']).value ?? '').trim() : '';
    const lotteryNameFromLabel = labelCell.toLowerCase().startsWith('lottery:')
      ? labelCell.replace(/^lottery:\s*/i, '').trim()
      : '';

    if (lotteryNameFromLabel) {
      lotteryRecord = await this.prisma.lottery.findFirst({
        where: { clientId, name: { equals: lotteryNameFromLabel, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, name: true, ticketPrice: true, clientId: true },
      });
    }

    // ── Process each row ───────────────────────────────────────────────────
    let approved = 0, rejected = 0, skipped = 0;
    const errors: Array<{ referenceCode: string; reason: string }> = [];
    const approvedTickets: Array<{ referenceCode: string; buyerName: string; tickets: string[] }> = [];

    for (const row of rows) {
      // All rows here are APPROVED — we filtered at parse time
      const identifier = row.phone || row.referenceCode || '(unknown)';
      try {
        // Find or create the buyer
        let buyer = await this.prisma.buyer.findFirst({ where: { clientId, phone: row.phone } });
        if (!buyer) {
          buyer = await this.prisma.buyer.create({
            data: {
              clientId,
              name:    row.buyerName || row.phone,
              phone:   row.phone,
              isGuest: true,
              status:  'ACTIVE',
            },
          });
        }

        // Find an existing non-final payment for this buyer, or create one
        let existingPayment = await this.prisma.paymentTransaction.findFirst({
          where: {
            clientId,
            buyerId:   buyer.id,
            deletedAt: null,
            status: { in: ['INITIATED', 'SUBMITTED', 'UNDER_REVIEW'] },
            ...(lotteryRecord ? { lotteryId: lotteryRecord.id } : {}),
          },
          select: { id: true, referenceCode: true, status: true },
        });

        if (!existingPayment) {
          if (!lotteryRecord) {
            errors.push({
              referenceCode: identifier,
              reason: 'Cannot create a payment: lottery not identified in the template label row.',
            });
            continue;
          }
          const amount = Number(lotteryRecord.ticketPrice) * row.qty;
          existingPayment = await this.prisma.paymentTransaction.create({
            data: {
              clientId,
              lotteryId:     lotteryRecord.id,
              buyerId:       buyer.id,
              amount,
              currency:      'ETB',
              status:        'SUBMITTED',
              provider:      'MANUAL_BANK_TRANSFER',
              referenceCode: generateReferenceCode(),
              notes:         'Created via Excel import',
            },
            select: { id: true, referenceCode: true, status: true },
          });

          // Assign available tickets to this new payment (by ticket numbers from the
          // template if present, otherwise grab the next available ones)
          const specificNums = row.ticketNums
            ? row.ticketNums.split(',').map(s => s.trim()).filter(Boolean)
            : [];

          let ticketIds: string[] = [];

          if (specificNums.length > 0) {
            // Try to find the specific ticket numbers listed in the template
            const found = await this.prisma.lotteryTicket.findMany({
              where: {
                lotteryId: lotteryRecord.id,
                ticketNumber: { in: specificNums },
                status: { in: ['AVAILABLE', 'RESERVED', 'PENDING_PAYMENT'] },
              },
              select: { id: true },
            });
            ticketIds = found.map(t => t.id);
          }

          // If no specific tickets found (or none listed), grab next available ones
          if (ticketIds.length === 0) {
            const available = await this.prisma.lotteryTicket.findMany({
              where: { lotteryId: lotteryRecord.id, status: 'AVAILABLE' },
              take: row.qty,
              orderBy: { ticketNumber: 'asc' },
              select: { id: true },
            });
            ticketIds = available.map(t => t.id);
          }

          if (ticketIds.length > 0) {
            await this.prisma.lotteryTicket.updateMany({
              where: { id: { in: ticketIds } },
              data: {
                paymentId: existingPayment.id,
                buyerId:   buyer.id,
                status:    'PENDING_PAYMENT',
              },
            });
          }

        } else if (existingPayment.status === 'INITIATED') {
          // If existing payment has no tickets linked yet, assign them now
          const linked = await this.prisma.lotteryTicket.count({
            where: { paymentId: existingPayment.id },
          });
          if (linked === 0 && lotteryRecord) {
            const available = await this.prisma.lotteryTicket.findMany({
              where: { lotteryId: lotteryRecord.id, status: 'AVAILABLE' },
              take: row.qty,
              orderBy: { ticketNumber: 'asc' },
              select: { id: true },
            });
            if (available.length > 0) {
              await this.prisma.lotteryTicket.updateMany({
                where: { id: { in: available.map(t => t.id) } },
                data: {
                  paymentId: existingPayment.id,
                  buyerId:   buyer.id,
                  status:    'PENDING_PAYMENT',
                },
              });
            }
          }
          await this.prisma.paymentTransaction.update({
            where: { id: existingPayment.id },
            data:  { status: 'SUBMITTED' },
          });
        }

        await this.approvePayment(existingPayment.id, reviewerId, { notes: row.notes || undefined });
        approved++;

        const finalized = await this.prisma.paymentTransaction.findUnique({
          where: { id: existingPayment.id },
          select: {
            referenceCode: true,
            buyer:   { select: { name: true } },
            tickets: { select: { ticketNumber: true }, orderBy: { ticketNumber: 'asc' } },
          },
        });
        if (finalized) {
          approvedTickets.push({
            referenceCode: finalized.referenceCode,
            buyerName:     (finalized.buyer as any)?.name ?? row.buyerName,
            tickets:       finalized.tickets.map((t) => t.ticketNumber),
          });
        }
      } catch (e: any) {
        errors.push({ referenceCode: identifier, reason: e?.message ?? 'Approval failed' });
      }
    }

    this.logger.log(
      `Import by ${reviewerId}: approved=${approved} rejected=${rejected} skipped=${skipped} errors=${errors.length}`,
    );

    return { approved, rejected, skipped, errors, approvedTickets };
  }

  // ==================== BULK IMPORT ====================

  /**
   * Blank template for bulk buyer import.
   * Lottery Name column has a dropdown populated from the client's active lotteries.
   * Reference Code, Ticket Numbers, Status are auto-filled by the system on import.
   * Columns: Buyer Name | Phone | Email | Lottery Name (dropdown) | Quantity | Amount Paid | Reference Code | Ticket Numbers | Status | Notes
   */
  async generateBulkImportTemplate(clientId: string): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lottery SaaS';

    const lotteries = await this.prisma.lottery.findMany({
      where: { clientId, status: { in: ['DRAFT', 'PUBLISHED', 'SELLING'] }, deletedAt: null },
      select: { name: true, ticketPrice: true },
      orderBy: { name: 'asc' },
    });

    // ── Available Lotteries reference sheet (must be created BEFORE main sheet
    //    so the cross-sheet formula for the dropdown is valid) ───────────────
    const refSheet = workbook.addWorksheet('📋 Available Lotteries');
    refSheet.columns = [
      { header: 'Lottery Name', key: 'name',  width: 40 },
      { header: 'Ticket Price', key: 'price', width: 16 },
    ];
    const rh = refSheet.getRow(1);
    rh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF312E81' } };
    rh.height = 20;
    lotteries.forEach(l => refSheet.addRow({ name: l.name, price: Number(l.ticketPrice).toFixed(2) }));

    // ── Main import sheet ──────────────────────────────────────────────────
    const sheet = workbook.addWorksheet('Buyers Import');

    // REQUIRED (always visible, marked *): Buyer Name, Phone, Lottery Name, Quantity, Amount
    // HIDDEN (auto-filled by system):      Email, Reference Code, Ticket Numbers, Status, Notes
    sheet.columns = [
      { header: 'Buyer Name *',      key: 'name',     width: 28 },
      { header: 'Phone Number *',    key: 'phone',    width: 20 },
      { header: 'Lottery Name *',    key: 'lottery',  width: 32 },
      { header: 'Quantity *',        key: 'quantity', width: 12 },
      { header: 'Amount Paid (ETB)', key: 'amount',   width: 18 },
      { header: 'Email',             key: 'email',    width:  0 },  // hidden
      { header: 'Reference Code',    key: 'ref',      width:  0 },  // hidden — auto-generated
      { header: 'Ticket Numbers',    key: 'tickets',  width:  0 },  // hidden — auto-filled
      { header: 'Status',            key: 'status',   width:  0 },  // hidden — auto-filled
      { header: 'Notes',             key: 'notes',    width:  0 },  // hidden
    ];

    // Hide optional/auto-filled columns
    sheet.getColumn('email').hidden   = true;
    sheet.getColumn('ref').hidden     = true;
    sheet.getColumn('tickets').hidden = true;
    sheet.getColumn('status').hidden  = true;
    sheet.getColumn('notes').hidden   = true;

    const hRow = sheet.getRow(1);
    hRow.height    = 24;
    hRow.alignment = { vertical: 'middle', horizontal: 'center' };
    // Required columns — green bold
    ['name','phone','lottery','quantity','amount'].forEach(k => {
      const cell = hRow.getCell(sheet.getColumn(k).number);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
    });
    // Hidden columns — grey
    ['email','ref','tickets','status','notes'].forEach(k => {
      const cell = hRow.getCell(sheet.getColumn(k).number);
      cell.font = { bold: false, color: { argb: 'FF6B7280' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    });

    // Build the lottery name dropdown formula
    const lotteryCount       = lotteries.length;
    const lotteryListFormula = lotteryCount > 0
      ? `'📋 Available Lotteries'!$A$2:$A$${lotteryCount + 1}`
      : '"No lotteries available"';

    // 3 sample rows — only fill required visible columns
    const sampleLottery = lotteries[0]?.name ?? 'My Lottery Name';
    const samplePrice   = Number(lotteries[0]?.ticketPrice ?? 100);

    [
      { name: 'Example Buyer 1', phone: '+251911000001', quantity: 2, amount: samplePrice * 2 },
      { name: 'Example Buyer 2', phone: '+251911000002', quantity: 1, amount: samplePrice * 1 },
      { name: 'Example Buyer 3', phone: '+251911000003', quantity: 3, amount: samplePrice * 3 },
    ].forEach((d, i) => {
      const row = sheet.addRow({
        name:     d.name,
        phone:    d.phone,
        lottery:  sampleLottery,
        quantity: d.quantity,
        amount:   d.amount.toFixed(2),
        // hidden columns — left blank, system fills on import
        email: '', ref: '', tickets: '', status: '', notes: '',
      });
      row.height = 18;
      ['name','phone','lottery','quantity','amount'].forEach(k => {
        row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FF0D1117' : 'FF111827' } };
      });

      // Lottery dropdown
      (row.getCell('lottery') as any).dataValidation = {
        type: 'list', allowBlank: false,
        formulae: [lotteryListFormula],
        showErrorMessage: true, errorTitle: 'Invalid lottery',
        error: 'Select a lottery from the dropdown list.',
        showInputMessage: true, promptTitle: 'Lottery',
        prompt: 'Choose a lottery from the list.',
      };
    });

    // Apply lottery dropdown to blank rows 5–500 so newly added rows also get it
    for (let r = 5; r <= 500; r++) {
      const cell = sheet.getCell(`C${r}`);  // col C = Lottery Name (new order)
      (cell as any).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: [lotteryListFormula],
        showErrorMessage: true, errorTitle: 'Invalid lottery',
        error: 'Select a lottery from the dropdown list.',
      };
    }

    sheet.views      = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'E1' };  // only over the 5 required visible columns

    // ── Instructions sheet ─────────────────────────────────────────────────
    const ins = workbook.addWorksheet('📖 Instructions');
    ins.getCell('A1').value = 'How to use the Buyers Import template';
    ins.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF34D399' } };
    [
      ['Step 1', 'Delete the 3 example rows (rows 2–4).'],
      ['Step 2', 'Add one row per buyer — fill the required columns: Buyer Name, Phone Number, Lottery Name, Quantity.'],
      ['Step 3', 'Click the "Lottery Name *" cell and pick from the dropdown — do not type it manually.'],
      ['Step 4', 'Amount Paid is optional — if left blank the system calculates it (ticket price × quantity).'],
      ['Step 5', 'Save the file and upload via "Bulk Import" on the Payments page.'],
      ['Step 6', 'Download the result file — it has the generated Reference Codes and assigned Ticket Numbers.'],
      ['',       ''],
      ['Required', 'Buyer Name * | Phone Number * | Lottery Name * | Quantity * | Amount Paid'],
      ['Hidden',   'Email, Reference Code, Ticket Numbers, Status, Notes — auto-filled by the system.'],
      ['Note 1',   'Duplicate phone numbers for the same lottery are skipped automatically.'],
      ['Note 2',   'Available lotteries are in the "📋 Available Lotteries" sheet.'],
    ].forEach(([k, v], i) => {
      ins.getCell(`A${i + 3}`).value = k;
      ins.getCell(`B${i + 3}`).value = v;
      if (String(k).startsWith('Step'))    ins.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF34D399' } };
      if (String(k).startsWith('Note'))    ins.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FFFBBF24' } };
      if (String(k) === 'Required')        ins.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF818CF8' } };
      if (String(k) === 'Hidden')          ins.getCell(`A${i + 3}`).font = { bold: true, color: { argb: 'FF6B7280' } };
    });
    ins.getColumn('A').width = 12;
    ins.getColumn('B').width = 82;

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Process bulk import — create buyer+payment per row, auto-approve, assign tickets.
   * Returns a result Excel buffer with Reference Codes and Ticket Numbers filled in.
   */
  async processBulkImport(
    fileBuffer: Buffer,
    clientId:   string,
    reviewerId: string,
  ): Promise<{
    resultBuffer: Buffer;
    imported: number; skipped: number; errors: number;
    rows: Array<{
      name: string; phone: string; lottery: string; quantity: number; amount: number;
      referenceCode: string; tickets: string; status: string; notes: string;
    }>;
  }> {
    const ExcelJS = await import('exceljs');
    const inWorkbook = new ExcelJS.Workbook();
    await inWorkbook.xlsx.load(
      fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength) as ArrayBuffer,
    );

    const sheet = inWorkbook.getWorksheet('Buyers Import') ?? inWorkbook.worksheets[0];
    if (!sheet) throw new BadRequestException('No worksheet found. Use the bulk import template.');

    const headerRow = sheet.getRow(1);
    const col: Record<string, number> = {};
    headerRow.eachCell((cell, n) => {
      const v = String(cell.value ?? '').toLowerCase().replace(/[^a-z]/g, '');
      if (v.includes('buyername') || v === 'name')      col['name']     = n;
      if (v.includes('phone'))                          col['phone']    = n;
      if (v.includes('email'))                          col['email']    = n;
      if (v.includes('lottery'))                        col['lottery']  = n;
      if (v.includes('quantity') || v.includes('qty')) col['quantity'] = n;
      if (v.includes('amount') || v.includes('paid'))  col['amount']   = n;
    });

    if (!col['name'] || !col['phone'] || !col['lottery'] || !col['quantity']) {
      throw new BadRequestException(
        'Invalid template — missing required columns (Buyer Name, Phone, Lottery Name, Quantity). Download the template first.',
      );
    }

    type InputRow = { name: string; phone: string; email: string; lotteryName: string; quantity: number; amountPaid: number | null; rowNum: number };
    const inputRows: InputRow[] = [];

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const name    = String(row.getCell(col['name']).value    ?? '').trim();
      const phone   = String(row.getCell(col['phone']).value   ?? '').trim();
      const lottery = String(row.getCell(col['lottery']).value ?? '').trim();
      const qty     = parseInt(String(row.getCell(col['quantity']).value ?? '0').replace(/[^0-9]/g, ''), 10);
      const email   = col['email'] ? String(row.getCell(col['email']).value ?? '').trim() : '';
      const rawAmt  = col['amount'] ? String(row.getCell(col['amount']).value ?? '').replace(/[^0-9.]/g, '') : '';
      const amount  = rawAmt ? parseFloat(rawAmt) : null;

      if (!name || !phone || !lottery || qty < 1) return;
      if (name.toLowerCase().startsWith('example')) return;
      if (phone.replace(/\D/g, '').includes('000000')) return;

      inputRows.push({ name, phone, email, lotteryName: lottery, quantity: qty, amountPaid: amount, rowNum });
    });

    if (inputRows.length === 0) {
      throw new BadRequestException('No valid data rows found. Delete the example rows and fill in real buyer data.');
    }

    // Cache lotteries
    const allLotteries = await this.prisma.lottery.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, clientId: true, ticketPrice: true, status: true, name: true },
    });
    const lotteryCache = new Map(allLotteries.map(l => [l.name.toLowerCase().trim(), l]));

    type ResultRow = InputRow & { referenceCode: string; resultStatus: string; notes: string; finalAmount: number; ticketNumbers: string };
    const resultRows: ResultRow[] = [];
    let imported = 0, skipped = 0, errors = 0;

    for (const row of inputRows) {
      const lottery = lotteryCache.get(row.lotteryName.toLowerCase().trim());
      if (!lottery) {
        resultRows.push({ ...row, referenceCode: '', resultStatus: 'ERROR', notes: `Lottery "${row.lotteryName}" not found`, finalAmount: 0, ticketNumbers: '' });
        errors++;
        continue;
      }

      const finalAmount = row.amountPaid ?? (Number(lottery.ticketPrice) * row.quantity);

      try {
        // Find or create buyer record
        let buyer = await this.prisma.buyer.findFirst({ where: { clientId, phone: row.phone } });
        if (!buyer) {
          buyer = await this.prisma.buyer.create({
            data: { clientId, name: row.name, phone: row.phone, email: row.email || null, isGuest: true, status: 'ACTIVE' },
          });
        }

        // Create payment as APPROVED (operator already collected money)
        const refCode = generateReferenceCode();
        const payment = await this.prisma.paymentTransaction.create({
          data: {
            clientId, lotteryId: lottery.id, buyerId: buyer.id,
            amount: finalAmount, currency: 'ETB',
            status: 'APPROVED',
            provider: 'MANUAL_BANK_TRANSFER',
            referenceCode: refCode,
            approvedAt: new Date(), reviewedAt: new Date(), reviewedById: reviewerId,
            notes: 'Bulk imported by operator',
          },
        });

        // Assign tickets — use raw approach since we bypass the reservation queue
        const available = await this.prisma.lotteryTicket.findMany({
          where: { lotteryId: lottery.id, status: 'AVAILABLE' },
          take: row.quantity,
          select: { id: true },
        });

        if (available.length < row.quantity) {
          await this.prisma.paymentTransaction.update({
            where: { id: payment.id },
            data: { status: 'UNDER_REVIEW', notes: `Bulk import — only ${available.length} tickets available (requested ${row.quantity})` },
          });
          resultRows.push({ ...row, finalAmount, referenceCode: refCode, resultStatus: 'UNDER_REVIEW', notes: `Payment created but only ${available.length}/${row.quantity} tickets available`, ticketNumbers: '' });
          errors++;
          continue;
        }

        await this.prisma.$transaction([
          this.prisma.lotteryTicket.updateMany({
            where: { id: { in: available.map(t => t.id) } },
            data: { status: 'SOLD', paymentId: payment.id, buyerId: buyer.id, assignedAt: new Date(), purchasedAt: new Date() },
          }),
          this.prisma.lottery.update({
            where: { id: lottery.id },
            data: { ticketsSold: { increment: row.quantity } },
          }),
        ]);

        // Fetch the assigned ticket numbers (now SOLD) to include in result
        const assignedTickets = await this.prisma.lotteryTicket.findMany({
          where: { id: { in: available.map(t => t.id) } },
          select: { ticketNumber: true },
          orderBy: { ticketNumber: 'asc' },
        });
        const ticketNumbers = assignedTickets.map((t) => t.ticketNumber).join(', ');

        resultRows.push({ ...row, finalAmount, referenceCode: refCode, resultStatus: 'APPROVED', notes: '', ticketNumbers });
        imported++;

      } catch (e: any) {
        resultRows.push({ ...row, finalAmount, referenceCode: '', resultStatus: 'ERROR', notes: e?.message ?? 'Unknown error', ticketNumbers: '' });
        errors++;
      }
    }

    this.logger.log(`Bulk import by ${reviewerId}: imported=${imported} skipped=${skipped} errors=${errors}`);

    // Build result Excel
    const outWorkbook = new ExcelJS.Workbook();
    const outSheet    = outWorkbook.addWorksheet('Import Results');
    outSheet.columns = [
      { header: 'Buyer Name',     key: 'name',     width: 28 },
      { header: 'Phone',          key: 'phone',    width: 18 },
      { header: 'Email',          key: 'email',    width: 30 },
      { header: 'Lottery',        key: 'lottery',  width: 28 },
      { header: 'Quantity',       key: 'quantity', width: 10 },
      { header: 'Amount (ETB)',   key: 'amount',   width: 14 },
      { header: 'Reference Code', key: 'ref',      width: 22 },
      { header: 'Ticket Numbers', key: 'tickets',  width: 40 },
      { header: 'Status',         key: 'status',   width: 14 },
      { header: 'Notes',          key: 'notes',    width: 48 },
    ];
    const oh = outSheet.getRow(1);
    oh.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    oh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
    oh.alignment = { vertical: 'middle', horizontal: 'center' };
    oh.height = 22;

    for (const r of resultRows) {
      const row = outSheet.addRow({
        name: r.name, phone: r.phone, email: r.email,
        lottery: r.lotteryName, quantity: r.quantity,
        amount: r.finalAmount.toFixed(2),
        ref:     r.referenceCode,
        tickets: r.ticketNumbers || '—',
        status:  r.resultStatus,
        notes:   r.notes,
      });
      row.height = 18;
      if (r.referenceCode) row.getCell('ref').font    = { bold: true, color: { argb: 'FF818CF8' }, family: 2 };
      if (r.ticketNumbers)  row.getCell('tickets').font = { color: { argb: 'FF34D399' } };
      const sc = r.resultStatus === 'APPROVED'     ? 'FF34D399'
               : r.resultStatus === 'SKIPPED'      ? 'FFFBBF24'
               : r.resultStatus === 'UNDER_REVIEW' ? 'FFA78BFA'
               :                                     'FFF87171';
      row.getCell('status').font = { bold: true, color: { argb: sc } };
    }

    outSheet.views = [{ state: 'frozen', ySplit: 1 }];
    outSheet.autoFilter = { from: 'A1', to: 'J1' };
    const sumRow = outSheet.addRow({ name: `✓ Imported: ${imported}   ✗ Errors: ${errors}   ↷ Skipped: ${skipped}   Total: ${resultRows.length}` });
    sumRow.getCell('name').font = { bold: true, color: { argb: 'FF9CA3AF' } };

    const resultBuffer = await outWorkbook.xlsx.writeBuffer();
    return {
      resultBuffer: Buffer.from(resultBuffer),
      imported, skipped, errors,
      rows: resultRows.map(r => ({
        name:          r.name,
        phone:         r.phone,
        lottery:       r.lotteryName,
        quantity:      r.quantity,
        amount:        r.finalAmount,
        referenceCode: r.referenceCode,
        tickets:       r.ticketNumbers,
        status:        r.resultStatus,
        notes:         r.notes,
      })),
    };
  }

  // ==================== BULK IMPORT JSON ====================

  /**
   * Browser-friendly bulk import — accepts plain JSON (no file upload).
   * Frontend posts { lotteryId, buyers: [{name, phone, email?, quantity}] }.
   * Returns per-row results with system-generated reference codes + ticket numbers.
   */
  async processBulkImportJson(
    lotteryId:  string,
    buyers:     Array<{ name: string; phone: string; email?: string; quantity: number }>,
    clientId:   string,
    reviewerId: string,
  ): Promise<{
    imported: number;
    skipped:  number;
    errors:   number;
    rows: Array<{
      name: string; phone: string; lottery: string;
      quantity: number; amount: number;
      referenceCode: string; tickets: string;
      status: string; notes: string;
    }>;
  }> {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
      select: { id: true, name: true, clientId: true, ticketPrice: true, deletedAt: true },
    });
    if (!lottery || lottery.deletedAt) throw new NotFoundException('Lottery not found');
    if (lottery.clientId !== clientId)  throw new NotFoundException('Lottery not found');

    type Row = {
      name: string; phone: string; email: string; lotteryName: string;
      quantity: number; finalAmount: number;
      referenceCode: string; ticketNumbers: string; resultStatus: string; notes: string;
    };
    const resultRows: Row[] = [];
    let imported = 0, skipped = 0, errors = 0;

    for (const buyer of buyers) {
      const finalAmount = Number(lottery.ticketPrice) * buyer.quantity;
      try {
        let buyerRecord = await this.prisma.buyer.findFirst({ where: { clientId, phone: buyer.phone } });
        if (!buyerRecord) {
          buyerRecord = await this.prisma.buyer.create({
            data: { clientId, name: buyer.name, phone: buyer.phone, email: buyer.email || null, isGuest: true, status: 'ACTIVE' },
          });
        }

        const refCode = generateReferenceCode();
        const payment = await this.prisma.paymentTransaction.create({
          data: {
            clientId, lotteryId: lottery.id, buyerId: buyerRecord.id,
            amount: finalAmount, currency: 'ETB',
            status: 'APPROVED', provider: 'MANUAL_BANK_TRANSFER',
            referenceCode: refCode,
            approvedAt: new Date(), reviewedAt: new Date(), reviewedById: reviewerId,
            notes: 'Bulk imported by operator',
          },
        });

        const available = await this.prisma.lotteryTicket.findMany({
          where: { lotteryId: lottery.id, status: 'AVAILABLE' },
          take: buyer.quantity,
          select: { id: true },
        });

        if (available.length < buyer.quantity) {
          await this.prisma.paymentTransaction.update({
            where: { id: payment.id },
            data: {
              status: 'UNDER_REVIEW',
              notes: 'Bulk import - only ' + available.length + ' tickets available (requested ' + buyer.quantity + ')',
            },
          });
          resultRows.push({
            name: buyer.name, phone: buyer.phone, email: buyer.email ?? '',
            lotteryName: lottery.name, quantity: buyer.quantity, finalAmount,
            referenceCode: refCode, ticketNumbers: '',
            resultStatus: 'UNDER_REVIEW',
            notes: 'Payment created but only ' + available.length + '/' + buyer.quantity + ' tickets available',
          });
          errors++;
          continue;
        }

        await this.prisma.$transaction([
          this.prisma.lotteryTicket.updateMany({
            where: { id: { in: available.map((t) => t.id) } },
            data: { status: 'SOLD', paymentId: payment.id, buyerId: buyerRecord.id, assignedAt: new Date(), purchasedAt: new Date() },
          }),
          this.prisma.lottery.update({
            where: { id: lottery.id },
            data: { ticketsSold: { increment: buyer.quantity } },
          }),
        ]);

        const assigned = await this.prisma.lotteryTicket.findMany({
          where: { id: { in: available.map((t) => t.id) } },
          select: { ticketNumber: true },
          orderBy: { ticketNumber: 'asc' },
        });

        resultRows.push({
          name: buyer.name, phone: buyer.phone, email: buyer.email ?? '',
          lotteryName: lottery.name, quantity: buyer.quantity, finalAmount,
          referenceCode: refCode,
          ticketNumbers: assigned.map((t) => t.ticketNumber).join(', '),
          resultStatus: 'APPROVED', notes: '',
        });
        imported++;

      } catch (e) {
        resultRows.push({
          name: buyer.name, phone: buyer.phone, email: buyer.email ?? '',
          lotteryName: lottery.name, quantity: buyer.quantity, finalAmount,
          referenceCode: '', ticketNumbers: '',
          resultStatus: 'ERROR', notes: (e as any)?.message ?? 'Unknown error',
        });
        errors++;
      }
    }

    this.logger.log('Bulk JSON import by ' + reviewerId + ': imported=' + imported + ' skipped=' + skipped + ' errors=' + errors);

    return {
      imported, skipped, errors,
      rows: resultRows.map((r) => ({
        name:          r.name,
        phone:         r.phone,
        lottery:       r.lotteryName,
        quantity:      r.quantity,
        amount:        r.finalAmount,
        referenceCode: r.referenceCode,
        tickets:       r.ticketNumbers,
        status:        r.resultStatus,
        notes:         r.notes,
      })),
    };
  }

}