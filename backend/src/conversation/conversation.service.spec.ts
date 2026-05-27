import { Test } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: {
    conversation: { findUnique: jest.Mock; create: jest.Mock };
    message: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      conversation: { findUnique: jest.fn(), create: jest.fn() },
      message: { create: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ConversationService);
  });

  describe('findOrCreate', () => {
    it('returns existing conversation when present', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1' });
      const result = await service.findOrCreate('u1', 'm1');
      expect(result).toEqual({ id: 'c1' });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a conversation when missing', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'c2', userId: 'u1', masterId: 'm1' });
      const result = await service.findOrCreate('u1', 'm1');
      expect(result.id).toBe('c2');
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { userId: 'u1', masterId: 'm1' },
      });
    });

    it('recovers from P2002 race (concurrent create) by re-fetching', async () => {
      prisma.conversation.findUnique
        .mockResolvedValueOnce(null) // initial check: nothing yet
        .mockResolvedValueOnce({ id: 'c_race_winner', userId: 'u1', masterId: 'm1' }); // re-fetch after P2002
      const p2002 = Object.assign(
        new Error('Unique constraint failed'),
        { code: 'P2002', clientVersion: 'test' },
      );
      Object.setPrototypeOf(p2002, (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype);
      prisma.conversation.create.mockRejectedValue(p2002);
      const result = await service.findOrCreate('u1', 'm1');
      expect(result.id).toBe('c_race_winner');
      expect(prisma.conversation.findUnique).toHaveBeenCalledTimes(2);
    });

    it('propagates non-P2002 errors from create', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce(null);
      const generic = new Error('boom');
      prisma.conversation.create.mockRejectedValue(generic);
      await expect(service.findOrCreate('u1', 'm1')).rejects.toThrow('boom');
    });
  });

  describe('addSystemCard', () => {
    it('persists a SYSTEM/SYSTEM_CARD message with payload and orderId', async () => {
      prisma.message.create.mockResolvedValue({ id: 'msg1' });
      const r = await service.addSystemCard({
        conversationId: 'c1',
        cardType: 'ORDER_CREATED',
        payload: { orderId: 'o1', skuName: 'x', finalPrice: 9900 },
        orderId: 'o1',
      });
      expect(r.id).toBe('msg1');
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          senderId: 'system',
          senderType: 'SYSTEM',
          type: 'SYSTEM_CARD',
          content: 'ORDER_CREATED',
          systemCardData: { orderId: 'o1', skuName: 'x', finalPrice: 9900 },
          relatedOrderId: 'o1',
          auditStatus: 'PASS',
        },
      });
    });
  });
});
