import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { LotteryService } from './lottery.service';
import { LotteryController } from './lottery.controller';
import { PlansModule } from '../plans/plans.module';
import { FilesModule } from '../files/files.module';
import { QUEUE_NAMES } from '../../common/constants';

@Module({
  imports: [
    PlansModule,
    FilesModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.TICKET_RESERVATION }),
  ],
  controllers: [LotteryController],
  providers: [LotteryService],
  exports: [LotteryService],
})
export class LotteryModule {}
