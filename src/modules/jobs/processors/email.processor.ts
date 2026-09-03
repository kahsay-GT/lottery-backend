import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { QUEUE_NAMES } from '../../../common/constants';

interface EmailJob {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  notificationId?: string;
}

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

  @Process('send-email')
  async handleSendEmail(job: Job<EmailJob>) {
    const { to, subject, html, text, from, notificationId } = job.data;

    try {
      await this.transporter.sendMail({ from, to, subject, html, text });
      this.logger.log(`Email sent to ${to}: ${subject}`);

      if (notificationId) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'SENT', sentAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);

      if (notificationId) {
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: {
            status: 'FAILED',
            failureReason: (error as Error).message,
            retryCount: { increment: 1 },
          },
        });
      }

      throw error;
    }
  }
}
