import { Module } from '@nestjs/common';
import { SlipVerifyService } from './slip-verify.service';

@Module({
  providers: [SlipVerifyService],
  exports: [SlipVerifyService],
})
export class SlipVerifyModule {}
