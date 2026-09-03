import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterBuyerDto {
  @ApiProperty({ example: 'buyer@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ minLength: 8, description: 'Password for buyer account' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password!: string;

  @ApiProperty({ example: 'John Buyer' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '+1234567890', description: 'Phone number for ticket notifications' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[0-9]{9,15}$/, {
    message: 'Invalid phone format',
  })
  phone!: string;

  @ApiProperty({ description: 'Client/Operator ID this buyer belongs to' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;
}

export class BuyerLoginDto {
  @ApiProperty({ example: 'buyer@example.com or +251912345678', description: 'Email or phone number' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  /** @deprecated — use identifier */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ description: 'Client/Operator ID' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;
}

export class UpdateBuyerProfileDto {
  @ApiPropertyOptional({ example: 'John Updated' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/, {
    message: 'Invalid phone format',
  })
  phone?: string;
}

export class BuyerChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}