import { Module } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.service';

@Module({
  providers: [WechatPayService],
  exports: [WechatPayService],
})
export class PaymentModule {}
