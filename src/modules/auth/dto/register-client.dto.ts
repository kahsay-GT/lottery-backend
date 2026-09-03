import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl, Matches, MinLength } from 'class-validator';

export class RegisterClientDto {
  @ApiProperty({ example: 'client@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Acme Lottery Co.' })
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;

  /** Chosen username for public profile URLs (/:username/lotteries) */
  @ApiPropertyOptional({ example: 'acme-lotteries' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,30}$/, {
    message: 'Username must be 3-30 chars: lowercase letters, numbers, hyphens or underscores only',
  })
  username?: string;

  /** Optional: plan the user selected on the pricing page */
  @ApiPropertyOptional({ example: 'plan-uuid' })
  @IsOptional()
  @IsString()
  planId?: string;

  /** Optional: billing cycle if a plan was selected */
  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsString()
  billingCycle?: 'MONTHLY' | 'YEARLY';
}
