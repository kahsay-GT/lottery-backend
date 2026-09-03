import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../../common/constants';

export interface SendEmailDto {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendNotificationDto {
  clientId?: string;
  buyerId?: string;
  channel: 'EMAIL' | 'SMS' | 'IN_APP';
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
    @Optional() @InjectQueue(QUEUE_NAMES.NOTIFICATION) private readonly notificationQueue: Queue,
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('email.host'),
      port: config.get<number>('email.port'),
      secure: config.get<boolean>('email.secure'),
      auth: {
        user: config.get<string>('email.user'),
        pass: config.get<string>('email.pass'),
      },
    });
  }

  async sendEmail(dto: SendEmailDto): Promise<void> {
    if (this.emailQueue) {
      await this.emailQueue.add('send-email', {
        from: this.config.get<string>('email.from'),
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    } else {
      // No Redis — send directly
      await this.sendDirectEmail(dto);
    }
  }

  async sendDirectEmail(dto: SendEmailDto): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('email.from'),
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
      });
      this.logger.log(`Email sent to ${dto.to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${dto.to}`, error);
      throw error;
    }
  }

  async createNotification(dto: SendNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        clientId: dto.clientId,
        buyerId: dto.buyerId,
        channel: dto.channel,
        recipient: dto.recipient,
        subject: dto.subject,
        body: dto.body,
        status: 'PENDING',
        metadata: dto.metadata ? JSON.parse(JSON.stringify(dto.metadata)) : undefined,
      },
    });

    if (this.notificationQueue) {
      await this.notificationQueue.add('process-notification', { notificationId: notification.id });
    } else {
      // No Redis — mark as sent immediately
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }
    return notification;
  }

  async notifyPaymentApproved(buyerEmail: string, ticketNumbers: string[], lotteryName: string) {
    const ticketList = ticketNumbers.join(', ');
    await this.sendEmail({
      to: buyerEmail,
      subject: `Payment Approved – ${lotteryName}`,
      html: `
        <h2>Your payment has been approved!</h2>
        <p>Your tickets for <strong>${lotteryName}</strong> are confirmed.</p>
        <p><strong>Ticket Numbers:</strong> ${ticketList}</p>
        <p>Good luck in the draw!</p>
      `,
    });
  }

  async notifyWinnersPublished(lotteryName: string, publicUrl: string, winnerEmails: string[]) {
    for (const email of winnerEmails) {
      await this.sendEmail({
        to: email,
        subject: `Winners Announced – ${lotteryName}`,
        html: `
          <h2>Winners have been announced!</h2>
          <p>The winners for <strong>${lotteryName}</strong> have been published.</p>
          <a href="${publicUrl}">View Results</a>
        `,
      });
    }
  }

  async notifySubscriptionApproved(clientEmail: string, planName: string) {
    await this.sendEmail({
      to: clientEmail,
      subject: 'Subscription Approved',
      html: `
        <h2>Your subscription has been approved!</h2>
        <p>Your <strong>${planName}</strong> plan is now active.</p>
        <p>You can now create lotteries on our platform.</p>
      `,
    });
  }

  async getNotifications(filters: {
    clientId?: string;
    buyerId?: string;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 20, clientId, buyerId } = filters;
    const skip = (page - 1) * limit;
    const where = {
      ...(clientId && { clientId }),
      ...(buyerId && { buyerId }),
    };
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: { total, page, limit, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    };
  }

  async markRead(notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'READ', readAt: new Date() },
    });
  }

  async getNotificationTemplates() {
    return this.prisma.notificationTemplate.findMany({ where: { isActive: true } });
  }
}
