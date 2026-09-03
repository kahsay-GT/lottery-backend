import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../database/prisma.service';
import { ReportsService } from '../../reports/reports.service';
import { QUEUE_NAMES } from '../../../common/constants';

@Processor(QUEUE_NAMES.EXPORT)
export class ExportProcessor {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
  ) {}

  @Process('generate-export')
  async handleGenerateExport(job: Job<{ exportId: string }>) {
    const { exportId } = job.data;

    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'PROCESSING' },
    });

    try {
      const exportRecord = await this.prisma.export.findUnique({ where: { id: exportId } });
      if (!exportRecord) return;

      // Generate based on type
      if (exportRecord.type === 'lottery-tickets' && exportRecord.lotteryId) {
        await this.reportsService.generateLotteryExcel(exportRecord.lotteryId);
        // In production: save to MinIO and update fileId
      }

      await this.prisma.export.update({
        where: { id: exportId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      this.logger.log(`Export ${exportId} completed`);
    } catch (error) {
      await this.prisma.export.update({
        where: { id: exportId },
        data: { status: 'FAILED', error: (error as Error).message },
      });
      this.logger.error(`Export ${exportId} failed`, error);
      throw error;
    }
  }
}
