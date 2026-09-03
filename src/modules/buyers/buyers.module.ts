import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BuyersService } from './buyers.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret') || 'access-secret',
        signOptions: { expiresIn: config.get<string>('jwt.accessExpiresIn') || '1d' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}