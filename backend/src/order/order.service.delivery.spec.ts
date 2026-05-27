import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { WechatPayService } from '../payment/wechat-pay.service';

describe('OrderService — delivery / confirm / dispute', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    asset: { create: jest.Mock };
    disputeCase: { create: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      asset: { create: jest.fn() },
      disputeCase: { create: jest.fn() },
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
        { provide: WechatPayService, useValue: { createPaymentIntent: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('deliverOrder', () => {
    it('creates Asset and transitions IN_PROGRESS → DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.asset.create.mockResolvedValue({ id: 'a1' });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'DELIVERED' });
      const result = await service.deliverOrder('m1', 'o1', {
        artifactUrl: 'https://cos.example/report.pdf',
        description: '完整报告 + 卦象图',
      });
      expect(result.state).toBe('DELIVERED');
      expect(prisma.asset.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'm1',
          ownerType: 'MASTER',
          category: 'delivery_report',
          url: 'https://cos.example/report.pdf',
          metadata: { description: '完整报告 + 卦象图' },
          relatedOrderId: 'o1',
        },
      });
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'DELIVERED', deliveredAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_DELIVERED',
          payload: expect.objectContaining({ orderId: 'o1', assetId: 'a1' }),
        }),
      );
    });

    it('rejects when state is not IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(
        service.deliverOrder('m1', 'o1', { artifactUrl: 'u', description: 'd' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR (master does not own order)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'IN_PROGRESS',
      });
      await expect(
        service.deliverOrder('m1', 'o1', { artifactUrl: 'u', description: 'd' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmDelivery', () => {
    it('transitions DELIVERED → COMPLETED with system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'COMPLETED' });
      const result = await service.confirmDelivery('u1', 'o1');
      expect(result.state).toBe('COMPLETED');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'COMPLETED', completedAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'ORDER_COMPLETED' }),
      );
    });

    it('rejects when not DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS',
      });
      await expect(service.confirmDelivery('u1', 'o1')).rejects.toThrow(ConflictException);
    });
  });

  describe('disputeOrder', () => {
    it('transitions DELIVERED → IN_DISPUTE and creates DisputeCase', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
      });
      prisma.disputeCase.create.mockResolvedValue({ id: 'd1' });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'IN_DISPUTE' });
      const result = await service.disputeOrder('u1', 'o1', {
        reason: '交付物简陋',
        userStatement: '只发了一段语音，没有正式报告',
        evidence: ['https://img/1.png'],
      });
      expect(result.state).toBe('IN_DISPUTE');
      expect(prisma.disputeCase.create).toHaveBeenCalledWith({
        data: {
          orderId: 'o1',
          userId: 'u1',
          reason: '交付物简陋',
          userStatement: '只发了一段语音，没有正式报告',
          evidence: ['https://img/1.png'],
        },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_DISPUTED',
          payload: expect.objectContaining({ orderId: 'o1', disputeId: 'd1' }),
        }),
      );
    });

    it('rejects when not DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'COMPLETED',
      });
      await expect(
        service.disputeOrder('u1', 'o1', {
          reason: 'x', userStatement: 'y', evidence: [],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
