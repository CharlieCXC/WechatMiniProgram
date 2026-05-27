import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PriceChange } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { computePlatformFee } from './platform-fee';

const PROPOSE_ALLOWED_STATES = new Set([
  'ACCEPTED',
  'PENDING_PAYMENT',
  'PAID',
  'IN_PROGRESS',
]);

@Injectable()
export class PriceChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async propose(
    masterId: string,
    orderId: string,
    input: { newPrice: number; reason: string },
  ): Promise<PriceChange> {
    if (input.newPrice < 1) {
      throw new BadRequestException('新价格必须为正整数（单位：分）');
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    if (!PROPOSE_ALLOWED_STATES.has(order.state)) {
      throw new ConflictException('订单状态不允许发起改价');
    }
    if (order.finalPrice === input.newPrice) {
      throw new BadRequestException('新价格与当前价格相同');
    }
    const pending = await this.prisma.priceChange.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException('已有未处理的改价请求');
    }
    const created = await this.prisma.priceChange.create({
      data: {
        orderId,
        fromPrice: order.finalPrice,
        toPrice: input.newPrice,
        reason: input.reason,
      },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'PRICE_CHANGE_REQUEST',
      payload: {
        orderId,
        priceChangeId: created.id,
        fromPrice: order.finalPrice,
        toPrice: input.newPrice,
        reason: input.reason,
      },
      orderId,
    });
    return created;
  }

  async respond(
    userId: string,
    priceChangeId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<PriceChange> {
    const pc = await this.prisma.priceChange.findUnique({ where: { id: priceChangeId } });
    if (!pc) throw new NotFoundException('改价请求不存在');
    if (pc.status !== 'PENDING') {
      throw new ConflictException('改价请求已被处理');
    }
    const order = await this.prisma.order.findUnique({ where: { id: pc.orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }

    if (decision === 'ACCEPTED') {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.priceChange.update({
          where: { id: priceChangeId },
          data: { status: 'ACCEPTED', decidedAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { finalPrice: pc.toPrice, platformFee: computePlatformFee(pc.toPrice) },
        });
        return updated;
      });
      await this.conversation.addSystemCard({
        conversationId: order.conversationId,
        cardType: 'PRICE_CHANGE_DECIDED',
        payload: { orderId: order.id, priceChangeId, decision: 'ACCEPTED' },
        orderId: order.id,
      });
      return result;
    }

    const updated = await this.prisma.priceChange.update({
      where: { id: priceChangeId },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'PRICE_CHANGE_DECIDED',
      payload: { orderId: order.id, priceChangeId, decision: 'REJECTED' },
      orderId: order.id,
    });
    return updated;
  }
}
