import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { QUEUE_NAMES } from '../../common/constants';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

@Global()
@Module({
  imports: [
    ...(isRedisEnabled ? [BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAIL },
      { name: QUEUE_NAMES.NOTIFICATION },
    )] : []),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
