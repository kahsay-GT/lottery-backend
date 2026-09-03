import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export enum ClientStatusAction {
  ACTIVATE = 'ACTIVATE',
  SUSPEND = 'SUSPEND',
}

export class CreateAdminDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, { message: 'Password too weak' })
  password!: string;

  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
}

export class UpdateAdminDto extends PartialType(CreateAdminDto) {}

export class UpdateClientStatusDto {
  @ApiProperty({ enum: ClientStatusAction })
  @IsEnum(ClientStatusAction)
  action!: ClientStatusAction;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class ToggleClientVerifiedDto {
  @ApiProperty({ description: 'Set to true to verify, false to remove verification' })
  @IsBoolean()
  isVerified!: boolean;
}

export class SystemSettingDto {
  @ApiProperty() @IsString() @IsNotEmpty() key!: string;
  @ApiProperty() @IsString() value!: string;
}

export class CreateBankAccountDto {
  @ApiProperty({ example: 'Commercial Bank of Ethiopia' })
  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @ApiProperty({ example: 'Lottery SaaS Platform' })
  @IsString()
  @IsNotEmpty()
  accountName!: string;

  @ApiProperty({ example: '1000123456789' })
  @IsString()
  @IsNotEmpty()
  accountNumber!: string;
}

export class UpdateBankAccountDto {
  @ApiPropertyOptional({ example: 'Awash Bank' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: 'Lottery SaaS Platform' })
  @IsOptional()
  @IsString()
  accountName?: string;

  @ApiPropertyOptional({ example: '1000123456789' })
  @IsOptional()
  @IsString()
  accountNumber?: string;
}

export class ToggleBankAccountStatusDto {
  @ApiProperty({ description: 'true = Active, false = Inactive' })
  @IsBoolean()
  isActive!: boolean;
}
