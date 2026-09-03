import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty() @IsUUID() planId!: string;
  @ApiProperty({ enum: BillingCycle }) @IsEnum(BillingCycle) billingCycle!: BillingCycle;
}

export class SubmitPaymentSlipDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ApproveSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class RejectSubscriptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class UpgradeSubscriptionDto {
  @ApiProperty() @IsUUID() newPlanId!: string;
  @ApiProperty({ enum: BillingCycle }) @IsEnum(BillingCycle) billingCycle!: BillingCycle;
}
