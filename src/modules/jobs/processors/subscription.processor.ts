import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PlansService } from '../../plans/plans.service';
import { QUEUE_NAMES } from '../../../common/constants';

@Processor(QUEUE_NAMES.SUBSCRIPTION_EXPIRY)
export class SubscriptionProcessor {
  private readonly logger = new Logger(SubscriptionProcessor.name);

  constructor(private readonly plansService: PlansService) {}

  @Process('expire-subscriptions')
  async handleExpireSubscriptions(_job: Job) {
    this.logger.debug('Running subscription expiry check');
    const count = await this.plansService.expireOverdueSubscriptions();
    this.logger.log(`Expired ${count} subscriptions`);
    return { expired: count };
  }
}
