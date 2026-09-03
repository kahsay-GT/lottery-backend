import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LotteryType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlanDto {
  @ApiProperty() @IsString() @IsNotEmpty() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) monthlyPrice!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) yearlyPrice!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) maxLotteriesPerCycle!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) maxActiveLotteries!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) maxTicketsPerLottery!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) minTicketPrice!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() maxTicketPrice!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) storageQuotaGb!: number;
  @ApiProperty({ enum: LotteryType, isArray: true })
  @IsArray() @IsEnum(LotteryType, { each: true }) lotteryTypesAllowed!: LotteryType[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasReporting?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasApiAccess?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() supportLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  @ApiPropertyOptional({ description: 'Activate or deactivate the plan' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
