import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExtensionService } from './extension.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('ExtensionService', () => {
  let service: ExtensionService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    extensionRequest: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      extensionRequest: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExtensionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(ExtensionService);
  });

  describe('propose', () => {
    it('creates a PENDING extension request in IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue(null);
      prisma.extensionRequest.create.mockResolvedValue({ id: 'ex1' });
      const result = await service.propose('m1', 'o1', { additionalHours: 24, reason: '资料补充中' });
      expect(result.id).toBe('ex1');
      expect(prisma.extensionRequest.create).toHaveBeenCalledWith({
        data: { orderId: 'o1', additionalHours: 24, reason: '资料补充中' },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'EXTENSION_REQUEST',
          payload: expect.objectContaining({ extensionId: 'ex1', additionalHours: 24 }),
        }),
      );
    });

    it('rejects when state is not IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(
        service.propose('m1', 'o1', { additionalHours: 24, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when there is already a PENDING extension', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue({ id: 'ex_existing' });
      await expect(
        service.propose('m1', 'o1', { additionalHours: 24, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects additionalHours not in [1, 168]', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { additionalHours: 0, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.propose('m1', 'o1', { additionalHours: 169, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respond', () => {
    it('ACCEPTED → updates Order.deliveryDeadline and decision card', async () => {
      const base = new Date('2026-05-26T00:00:00Z');
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING', additionalHours: 24,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1', deliveryDeadline: base,
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          extensionRequest: { update: jest.fn().mockResolvedValue({ id: 'ex1', status: 'ACCEPTED' }) },
          order: { update: jest.fn().mockResolvedValue({ id: 'o1' }) },
        }),
      );
      const result = await service.respond('u1', 'ex1', 'ACCEPTED');
      expect(result.status).toBe('ACCEPTED');
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'EXTENSION_DECIDED' }),
      );
    });

    it('REJECTED → no deadline change, decision card', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING', additionalHours: 24,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.extensionRequest.update.mockResolvedValue({ id: 'ex1', status: 'REJECTED' });
      const result = await service.respond('u1', 'ex1', 'REJECTED');
      expect(result.status).toBe('REJECTED');
    });

    it('rejects when extension not PENDING', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', status: 'ACCEPTED',
      });
      await expect(service.respond('u1', 'ex1', 'ACCEPTED')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING',
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'IN_PROGRESS',
      });
      await expect(service.respond('u1', 'ex1', 'ACCEPTED')).rejects.toThrow(NotFoundException);
    });
  });
});
