import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { WechatPayService } from '../payment/wechat-pay.service';

describe('OrderService — payment', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };
  let pay: { createPaymentIntent: jest.Mock };

  beforeEach(async () => {
    prisma = { order: { findUnique: jest.fn(), update: jest.fn() } };
    conv = { addSystemCard: jest.fn() };
    pay = { createPaymentIntent: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
        { provide: WechatPayService, useValue: pay },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('requestPayment', () => {
    it('transitions ACCEPTED → PENDING_PAYMENT and returns payment intent', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'ACCEPTED', conversationId: 'c1', finalPrice: 9900,
        skuSnapshot: { name: 'x' },
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'PENDING_PAYMENT' });
      pay.createPaymentIntent.mockResolvedValue({
        prepayId: 'STUB_PREPAY_o1', outTradeNo: 'STUB_o1', signTimestamp: '1',
      });
      const result = await service.requestPayment('u1', 'o1', 'wx_oid');
      expect(result.order.state).toBe('PENDING_PAYMENT');
      expect(result.paymentIntent.prepayId).toBe('STUB_PREPAY_o1');
      expect(pay.createPaymentIntent).toHaveBeenCalledWith({
        orderId: 'o1', amount: 9900, openid: 'wx_oid', description: 'x',
      });
    });

    it('rejects when order is not in ACCEPTED state', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'PENDING_ACCEPT',
      });
      await expect(service.requestPayment('u1', 'o1', 'wx_oid')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'ACCEPTED',
      });
      await expect(service.requestPayment('u1', 'o1', 'wx_oid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmPayment', () => {
    it('transitions PENDING_PAYMENT → IN_PROGRESS, sets deliveryDeadline, sends ORDER_PAID', async () => {
      const acceptedAt = new Date('2026-05-26T00:00:00Z');
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', state: 'PENDING_PAYMENT', conversationId: 'c1', finalPrice: 9900,
        acceptedAt,
        skuSnapshot: { deliveryHour: 48, type: 'ASYNC_REPORT' },
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'IN_PROGRESS' });
      const result = await service.confirmPayment('o1');
      expect(result.state).toBe('IN_PROGRESS');
      const arg = prisma.order.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'o1' });
      expect(arg.data.state).toBe('IN_PROGRESS');
      expect(arg.data.deliveryDeadline).toBeInstanceOf(Date);
      // 48h from now (not from acceptedAt — deadline 起算 = 付款成功时刻)
      const expectedMs = Date.now() + 48 * 3600 * 1000;
      expect(Math.abs(arg.data.deliveryDeadline.getTime() - expectedMs)).toBeLessThan(5000);
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_PAID',
          payload: { orderId: 'o1', paidAmount: 9900 },
        }),
      );
    });

    it('rejects when not in PENDING_PAYMENT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', state: 'ACCEPTED',
      });
      await expect(service.confirmPayment('o1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFound when order missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.confirmPayment('x')).rejects.toThrow(NotFoundException);
    });
  });
});
