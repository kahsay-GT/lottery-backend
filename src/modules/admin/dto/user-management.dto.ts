import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  SUPPORT = 'support',
  VIEWER = 'viewer',
}

export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  [AdminRole.SUPER_ADMIN]: [
    'manage:admins', 'manage:roles', 'manage:clients', 'manage:plans', 'manage:subscriptions',
    'manage:lotteries', 'manage:payments', 'view:audit_logs', 'manage:settings', 'view:reports',
    'approve:payments', 'approve:operators', 'approve:subscriptions', 'export:data',
  ],
  [AdminRole.ADMIN]: [
    'manage:clients', 'manage:plans', 'manage:subscriptions', 'manage:lotteries',
    'manage:payments', 'view:audit_logs', 'view:reports', 'approve:payments',
    'approve:operators', 'approve:subscriptions', 'export:data',
  ],
  [AdminRole.MANAGER]: [
    'view:clients', 'view:lotteries', 'manage:payments', 'view:reports',
    'approve:payments', 'approve:operators', 'export:data',
  ],
  [AdminRole.SUPPORT]: [
    'view:clients', 'view:lotteries', 'view:payments', 'approve:payments',
  ],
  [AdminRole.VIEWER]: [
    'view:clients', 'view:lotteries', 'view:payments', 'view:reports',
  ],
};

export class CreateUserDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty() @IsString() @IsNotEmpty() name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;

  @ApiProperty({ enum: AdminRole }) @IsEnum(AdminRole) role!: AdminRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;

  @ApiPropertyOptional({ enum: AdminRole }) @IsOptional() @IsEnum(AdminRole) role?: AdminRole;

  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
}

export class AssignPermissionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) permissions!: string[];
}

export class ApprovalLogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() adminId?: string;

  @ApiPropertyOptional() @IsOptional() startDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
}