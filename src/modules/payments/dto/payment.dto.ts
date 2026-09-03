import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class InitiatePaymentDto {
  @ApiProperty() @IsUUID() lotteryId!: string;
  @ApiProperty() @IsUUID() reservationId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() buyerName!: string;

  // Phone required
  @ApiProperty()
  @IsString() @IsNotEmpty()
  buyerPhone!: string;

  // Email optional
  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsEmail()
  buyerEmail?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() idempotencyKey?: string;
}

export class SubmitPaymentSlipDto {
  @ApiProperty() @IsUUID() paymentId!: string;
}

export class ReviewPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class RejectPaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class RefundPaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}

export class InitiateSubscriptionPaymentDto {
  @ApiProperty() @IsUUID() subscriptionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() idempotencyKey?: string;
}

export class DeletePaymentDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
