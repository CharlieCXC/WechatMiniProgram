import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { WechatPayService } from '../payment/wechat-pay.service';

describe('OrderService — cancel', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = { order: { findUnique: jest.fn(), update: jest.fn() } };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
        {
          provide: WechatPayService,
          useValue: { createPaymentIntent: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  it.each([
    ['PENDING_ACCEPT', 'CANCELLED'],
    ['ACCEPTED', 'CANCELLED'],
    ['PENDING_PAYMENT', 'CANCELLED'],
    ['PAID', 'REFUNDED'],
    ['IN_PROGRESS', 'REFUNDED'],
  ])('cancel from %s → %s', async (from, to) => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      state: from,
      conversationId: 'c1',
    });
    prisma.order.update.mockResolvedValue({ id: 'o1', state: to });
    const result = await service.cancelOrder('u1', 'o1');
    expect(result.state).toBe(to);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { state: to },
    });
    expect(conv.addSystemCard).toHaveBeenCalledWith(
      expect.objectContaining({
        cardType: 'ORDER_CANCELLED',
        payload: { orderId: 'o1', by: 'USER' },
      }),
    );
  });

  it('throws NotFound when order missing', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.cancelOrder('u1', 'x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects IDOR (user does not own the order)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u_other',
      state: 'PENDING_ACCEPT',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects from DELIVERED state', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      state: 'DELIVERED',
      conversationId: 'c1',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(
      ConflictException,
    );
  });
});
