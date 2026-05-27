import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PriceChangeService } from './price-change.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('PriceChangeService', () => {
  let service: PriceChangeService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    priceChange: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      priceChange: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceChangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(PriceChangeService);
  });

  describe('propose', () => {
    it('creates a PENDING price change in IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900, conversationId: 'c1',
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      prisma.priceChange.create.mockResolvedValue({
        id: 'pc1', orderId: 'o1', fromPrice: 9900, toPrice: 19900,
      });
      const result = await service.propose('m1', 'o1', { newPrice: 19900, reason: '需追加八字' });
      expect(result.id).toBe('pc1');
      expect(prisma.priceChange.create).toHaveBeenCalledWith({
        data: { orderId: 'o1', fromPrice: 9900, toPrice: 19900, reason: '需追加八字' },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'PRICE_CHANGE_REQUEST',
          payload: expect.objectContaining({ priceChangeId: 'pc1', fromPrice: 9900, toPrice: 19900 }),
        }),
      );
    });

    it('rejects when there is already a PENDING price change on this order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when order is in DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'DELIVERED',
      });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'IN_PROGRESS',
      });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when newPrice equals current finalPrice', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { newPrice: 9900, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects newPrice below 1', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { newPrice: 0, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respond', () => {
    it('ACCEPTED → updates finalPrice + platformFee + decision card', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING', toPrice: 19900,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          priceChange: { update: jest.fn().mockResolvedValue({ id: 'pc1', status: 'ACCEPTED' }) },
          order: { update: jest.fn().mockResolvedValue({ id: 'o1', finalPrice: 19900, platformFee: 1990 }) },
        }),
      );
      const result = await service.respond('u1', 'pc1', 'ACCEPTED');
      expect(result.status).toBe('ACCEPTED');
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'PRICE_CHANGE_DECIDED',
          payload: expect.objectContaining({ priceChangeId: 'pc1', decision: 'ACCEPTED' }),
        }),
      );
    });

    it('REJECTED → marks status, no order update, decision card', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING', toPrice: 19900,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.priceChange.update.mockResolvedValue({ id: 'pc1', status: 'REJECTED' });
      const result = await service.respond('u1', 'pc1', 'REJECTED');
      expect(result.status).toBe('REJECTED');
    });

    it('rejects when price change is not PENDING', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'ACCEPTED',
      });
      await expect(service.respond('u1', 'pc1', 'ACCEPTED')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR (user is not the order owner)', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING',
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'IN_PROGRESS',
      });
      await expect(service.respond('u1', 'pc1', 'ACCEPTED')).rejects.toThrow(NotFoundException);
    });
  });
});
