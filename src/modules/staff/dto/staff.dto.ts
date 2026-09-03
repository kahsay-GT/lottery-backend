import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength,
} from 'class-validator';

export enum StaffRoleDto {
  APPROVER = 'APPROVER',
  VIEWER   = 'VIEWER',
}

export class CreateStaffDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: StaffRoleDto, default: StaffRoleDto.VIEWER })
  @IsEnum(StaffRoleDto)
  role!: StaffRoleDto;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: StaffRoleDto })
  @IsOptional()
  @IsEnum(StaffRoleDto)
  role?: StaffRoleDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class StaffLoginDto {
  @ApiProperty({ description: 'Email address or phone number' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;   // email OR phone

  /** @deprecated — use identifier */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty()
  @IsString()
  password!: string;

  @ApiProperty({ description: 'Operator (client) ID this staff belongs to' })
  @IsString()
  @IsNotEmpty()
  clientId!: string;
}
