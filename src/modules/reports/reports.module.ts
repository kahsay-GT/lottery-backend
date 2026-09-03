import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { QUEUE_NAMES } from '../../common/constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EXPORT })],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
