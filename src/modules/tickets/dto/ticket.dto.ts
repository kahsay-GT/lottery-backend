import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray, IsEmail, IsInt, IsNotEmpty,
  IsOptional, IsString, IsUUID, Max, Min,
} from 'class-validator';
import { MAX_TICKETS_PER_PURCHASE } from '../../../common/constants';

export class ReserveTicketsDto {
  @ApiProperty() @IsUUID() lotteryId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_TICKETS_PER_PURCHASE })
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_TICKETS_PER_PURCHASE)
  quantity!: number;

  // Phone is required — primary contact for buyers without email
  @ApiProperty()
  @IsString() @IsNotEmpty()
  buyerPhone!: string;

  @ApiProperty() @IsString() @IsNotEmpty() buyerName!: string;

  // Email is optional
  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsEmail()
  buyerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsArray() @IsString({ each: true })
  ticketNumbers?: string[];

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  idempotencyKey?: string;
}

export class ConfirmReservationDto {
  @ApiProperty() @IsUUID() reservationId!: string;
}

export class BuyTicketsDto extends ReserveTicketsDto {}
