import { Module, forwardRef } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.service';
import { PaymentNotifyController } from './payment-notify.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [forwardRef(() => OrderModule)],
  controllers: [PaymentNotifyController],
  providers: [WechatPayService],
  exports: [WechatPayService],
})
export class PaymentModule {}
