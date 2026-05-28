import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WechatPayService } from './wechat-pay.service';
import { WechatPayNotifyDto } from './dto/wechat-pay-notify.dto';
import { OrderService } from '../order/order.service';

@ApiTags('payment')
@Controller('payments/wechat')
export class PaymentNotifyController {
  constructor(
    private readonly wechatPay: WechatPayService,
    private readonly orders: OrderService,
  ) {}

  @Post('notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信支付回调（stub）' })
  async notify(@Body() body: WechatPayNotifyDto) {
    if (!this.wechatPay.verifyNotify(body)) {
      throw new BadRequestException('签名校验失败');
    }
    const orderId = this.wechatPay.parseOrderIdFromTradeNo(body.outTradeNo);
    if (!orderId) {
      throw new BadRequestException('无法解析 outTradeNo');
    }
    await this.orders.confirmPayment(orderId);
    return { ok: true };
  }
}
