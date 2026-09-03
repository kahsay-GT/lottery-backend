import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LotteryType, LotteryVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty,
  IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';

export class ReorderImagesDto {
  @ApiProperty({ type: [String], description: 'Image IDs in desired display order' })
  @IsArray()
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}

export class CreatePrizeDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) rank!: number;
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) prizeValue!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) quantity!: number;
}

export class CreateLotteryDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ enum: LotteryType }) @IsEnum(LotteryType) type!: LotteryType;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) ticketPrice!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) totalTickets!: number;

  /** First ticket number in the physical range (default 1) */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) ticketStart?: number;
  /** Last ticket number in the range — must equal ticketStart + totalTickets - 1 */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) ticketEnd?: number;

  @ApiProperty() @IsDateString() saleStartDate!: string;
  @ApiProperty() @IsDateString() saleEndDate!: string;
  @ApiProperty() @IsDateString() drawDate!: string;

  @ApiProperty({ enum: LotteryVisibility }) @IsEnum(LotteryVisibility) visibility!: LotteryVisibility;

  @ApiPropertyOptional() @IsOptional() @IsString() termsConditions?: string;

  @ApiPropertyOptional({ type: [CreatePrizeDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreatePrizeDto)
  prizes?: CreatePrizeDto[];
}

export class UpdateLotteryDto extends PartialType(CreateLotteryDto) {}
