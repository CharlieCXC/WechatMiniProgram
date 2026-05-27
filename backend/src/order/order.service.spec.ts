import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('OrderService — create/accept/reject', () => {
  let service: OrderService;
  let prisma: {
    serviceSKU: { findUnique: jest.Mock };
    master: { findUnique: jest.Mock };
    order: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: {
    findOrCreate: jest.Mock;
    addSystemCard: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      serviceSKU: { findUnique: jest.fn() },
      master: { findUnique: jest.fn() },
      order: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    conv = {
      findOrCreate: jest.fn(),
      addSystemCard: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('createOrder', () => {
    it('creates an order in PENDING_ACCEPT with 10% platform fee and a system card', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', name: '八字解读', price: 9900,
        status: 'ACTIVE', type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1', status: 'ACTIVE', onboardingStep: 'LIVE',
      });
      conv.findOrCreate.mockResolvedValue({ id: 'c1' });
      prisma.order.create.mockImplementation(async ({ data }) => ({ id: 'o1', ...data }));

      const order = await service.createOrder('u1', 'sku1');
      expect(order.id).toBe('o1');
      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          masterId: 'm1',
          skuId: 'sku1',
          skuSnapshot: expect.objectContaining({ id: 'sku1', price: 9900 }),
          state: 'PENDING_ACCEPT',
          conversationId: 'c1',
          originalPrice: 9900,
          finalPrice: 9900,
          platformFee: 990,
        },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_CREATED',
          orderId: 'o1',
          conversationId: 'c1',
          payload: expect.objectContaining({ orderId: 'o1', skuName: '八字解读', finalPrice: 9900 }),
        }),
      );
    });

    it('rejects creating an order against a DISABLED sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', price: 9900, status: 'DISABLED',
        type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      await expect(service.createOrder('u1', 'sku1')).rejects.toThrow(BadRequestException);
    });

    it('rejects creating an order against a non-ACTIVE master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', price: 9900, status: 'ACTIVE',
        type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1', status: 'PENDING', onboardingStep: 'INVITED',
      });
      await expect(service.createOrder('u1', 'sku1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when sku missing', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue(null);
      await expect(service.createOrder('u1', 'sku_nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptOrder', () => {
    it('transitions PENDING_ACCEPT → ACCEPTED with system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'PENDING_ACCEPT', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'ACCEPTED' });
      const result = await service.acceptOrder('m1', 'o1');
      expect(result.state).toBe('ACCEPTED');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'ACCEPTED', acceptedAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'ORDER_ACCEPTED', orderId: 'o1' }),
      );
    });

    it('throws NotFound when order missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.acceptOrder('m1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('rejects when caller is not the order master (IDOR)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'PENDING_ACCEPT',
      });
      await expect(service.acceptOrder('m1', 'o1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when order state is not PENDING_ACCEPT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(service.acceptOrder('m1', 'o1')).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectOrder', () => {
    it('transitions PENDING_ACCEPT → CANCELLED with reason in system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'PENDING_ACCEPT', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'CANCELLED' });
      const result = await service.rejectOrder('m1', 'o1', '日程不便');
      expect(result.state).toBe('CANCELLED');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'CANCELLED' },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_REJECTED',
          orderId: 'o1',
          payload: expect.objectContaining({ orderId: 'o1', reason: '日程不便' }),
        }),
      );
    });

    it('rejects IDOR (master does not own order)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'PENDING_ACCEPT',
      });
      await expect(service.rejectOrder('m1', 'o1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('rejects when state is not PENDING_ACCEPT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(service.rejectOrder('m1', 'o1', 'x')).rejects.toThrow(ConflictException);
    });
  });
});

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
      id: 'o1', userId: 'u1', state: from, conversationId: 'c1',
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
    await expect(service.cancelOrder('u1', 'x')).rejects.toThrow(NotFoundException);
  });

  it('rejects IDOR (user does not own the order)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', userId: 'u_other', state: 'PENDING_ACCEPT',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(NotFoundException);
  });

  it('rejects from DELIVERED state', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(ConflictException);
  });
});
