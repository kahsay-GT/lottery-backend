import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MinLength, ValidateIf } from 'class-validator';

// Helper: transform empty strings to undefined so validators skip them
const EmptyToUndefined = () =>
  Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class UpdateClientProfileDto {
  @ApiPropertyOptional({ example: 'lucky-draws', description: 'Public URL username (letters, numbers, hyphens; 3–30 chars)' })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9-]+$/, { message: 'Username can only contain lowercase letters, numbers, and hyphens' })
  username?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ example: 'Acme Lotteries Ltd.' })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(2)
  businessName?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'https://yoursite.com' })
  @EmptyToUndefined()
  @IsOptional()
  // Only validate URL format when the value is actually present
  @ValidateIf((o) => o.website !== undefined)
  @IsUrl({}, { message: 'website must be a valid URL (include https://)' })
  website?: string;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @EmptyToUndefined()
  @IsOptional()
  @IsString()
  city?: string;
}
