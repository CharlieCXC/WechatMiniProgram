import { Injectable } from '@nestjs/common';

export interface CreatePaymentIntentInput {
  orderId: string;
  amount: number; // 分
  openid: string;
  description: string;
}

export interface PaymentIntent {
  prepayId: string;
  outTradeNo: string;
  signTimestamp: string;
}

export interface NotifyBody {
  outTradeNo?: string;
}

@Injectable()
export class WechatPayService {
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    return {
      prepayId: `STUB_PREPAY_${input.orderId}`,
      outTradeNo: `STUB_${input.orderId}`,
      signTimestamp: String(Math.floor(Date.now() / 1000)),
    };
  }

  verifyNotify(body: NotifyBody): boolean {
    return !!body.outTradeNo;
  }

  parseOrderIdFromTradeNo(outTradeNo: string): string | null {
    const m = outTradeNo.match(/^STUB_(.+)$/);
    return m ? m[1] : null;
  }
}
