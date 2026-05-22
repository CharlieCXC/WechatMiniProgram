import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WechatModule } from '../wechat/wechat.module';
import { UserModule } from '../user/user.module';
import { SmsModule } from '../sms/sms.module';
import { MasterModule } from '../master/master.module';
import { AppConfigService } from '../config/config.service';

@Module({
  imports: [
    WechatModule,
    UserModule,
    SmsModule,
    MasterModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({ secret: config.jwt.secret }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
