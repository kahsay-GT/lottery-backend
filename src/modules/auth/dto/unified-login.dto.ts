import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnifiedLoginDto {
  @ApiProperty({
    description: 'Email address or phone number (E.164 or local format)',
    example: '+251912345678 or user@example.com',
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
