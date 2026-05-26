import { Test } from '@nestjs/testing';
import { WechatPayService } from './wechat-pay.service';

describe('WechatPayService (stub)', () => {
  let service: WechatPayService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [WechatPayService],
    }).compile();
    service = moduleRef.get(WechatPayService);
  });

  it('createPaymentIntent returns deterministic stub prepay params', async () => {
    const result = await service.createPaymentIntent({
      orderId: 'o1',
      amount: 9900,
      openid: 'wx_oid',
      description: '测试订单',
    });
    expect(result).toMatchObject({
      prepayId: expect.stringMatching(/^STUB_PREPAY_o1$/),
      outTradeNo: expect.stringMatching(/^STUB_o1$/),
    });
    expect(typeof result.signTimestamp).toBe('string');
  });

  it('verifyNotify returns true for any non-empty body in stub mode', () => {
    expect(service.verifyNotify({ outTradeNo: 'STUB_o1' })).toBe(true);
    expect(service.verifyNotify({})).toBe(false);
  });

  it('parseOrderIdFromTradeNo extracts orderId from stub trade no', () => {
    expect(service.parseOrderIdFromTradeNo('STUB_abc123')).toBe('abc123');
  });

  it('parseOrderIdFromTradeNo returns null for foreign formats', () => {
    expect(service.parseOrderIdFromTradeNo('1234567890')).toBeNull();
  });
});
