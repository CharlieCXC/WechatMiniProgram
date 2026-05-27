import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

const PLATFORM_FEE_RATE = 0.1;

function computePlatformFee(finalPrice: number): number {
  return Math.floor(finalPrice * PLATFORM_FEE_RATE);
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async createOrder(userId: string, skuId: string): Promise<Order> {
    const sku = await this.prisma.serviceSKU.findUnique({ where: { id: skuId } });
    if (!sku) throw new NotFoundException('SKU 不存在');
    if (sku.status !== 'ACTIVE') {
      throw new BadRequestException('SKU 已下架');
    }
    const master = await this.prisma.master.findUnique({ where: { id: sku.masterId } });
    if (!master || master.status !== 'ACTIVE') {
      throw new BadRequestException('师傅未上架');
    }

    const conv = await this.conversation.findOrCreate(userId, sku.masterId);
    const finalPrice = sku.price;
    const platformFee = computePlatformFee(finalPrice);
    const order = await this.prisma.order.create({
      data: {
        userId,
        masterId: sku.masterId,
        skuId: sku.id,
        skuSnapshot: sku as unknown as Prisma.InputJsonValue,
        state: 'PENDING_ACCEPT',
        conversationId: conv.id,
        originalPrice: sku.price,
        finalPrice,
        platformFee,
      },
    });
    await this.conversation.addSystemCard({
      conversationId: conv.id,
      cardType: 'ORDER_CREATED',
      payload: { orderId: order.id, skuName: sku.name, finalPrice },
      orderId: order.id,
    });
    return order;
  }

  private async getOrderOwnedByMasterOrThrow(
    masterId: string,
    orderId: string,
  ): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  async acceptOrder(masterId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'PENDING_ACCEPT') {
      throw new ConflictException('订单状态不允许接单');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'ACCEPTED', acceptedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_ACCEPTED',
      payload: { orderId },
      orderId,
    });
    return updated;
  }

  async rejectOrder(
    masterId: string,
    orderId: string,
    reason: string,
  ): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'PENDING_ACCEPT') {
      throw new ConflictException('订单状态不允许拒单');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'CANCELLED' },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_REJECTED',
      payload: { orderId, reason },
      orderId,
    });
    return updated;
  }
}
