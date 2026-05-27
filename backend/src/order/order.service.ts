import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { WechatPayService } from '../payment/wechat-pay.service';

const PLATFORM_FEE_RATE = 0.1;

function computePlatformFee(finalPrice: number): number {
  return Math.floor(finalPrice * PLATFORM_FEE_RATE);
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
    private readonly wechatPay: WechatPayService,
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

  private async getOrderOwnedByUserOrThrow(userId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  async cancelOrder(userId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    const preRefundStates = ['PENDING_ACCEPT', 'ACCEPTED', 'PENDING_PAYMENT'];
    const postPaymentStates = ['PAID', 'IN_PROGRESS'];
    let targetState: 'CANCELLED' | 'REFUNDED';
    if (preRefundStates.includes(order.state)) {
      targetState = 'CANCELLED';
    } else if (postPaymentStates.includes(order.state)) {
      targetState = 'REFUNDED';
    } else {
      throw new ConflictException('订单状态不允许取消');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: targetState },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_CANCELLED',
      payload: { orderId, by: 'USER' },
      orderId,
    });
    return updated;
  }

  async requestPayment(
    userId: string,
    orderId: string,
    openid: string,
  ): Promise<{ order: Order; paymentIntent: { prepayId: string; outTradeNo: string; signTimestamp: string } }> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'ACCEPTED') {
      throw new ConflictException('订单状态不允许发起支付');
    }
    const sku = order.skuSnapshot as { name: string };
    const paymentIntent = await this.wechatPay.createPaymentIntent({
      orderId,
      amount: order.finalPrice,
      openid,
      description: sku.name,
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'PENDING_PAYMENT' },
    });
    return { order: updated, paymentIntent };
  }

  async confirmPayment(orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.state !== 'PENDING_PAYMENT') {
      throw new ConflictException('订单状态不允许确认支付');
    }
    const snapshot = order.skuSnapshot as { deliveryHour?: number };
    const hours = snapshot.deliveryHour ?? 0;
    const deadline = new Date(Date.now() + hours * 3600 * 1000);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'IN_PROGRESS', deliveryDeadline: deadline },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_PAID',
      payload: { orderId, paidAmount: order.finalPrice },
      orderId,
    });
    return updated;
  }

  async deliverOrder(
    masterId: string,
    orderId: string,
    input: { artifactUrl: string; description: string },
  ): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'IN_PROGRESS') {
      throw new ConflictException('订单状态不允许交付');
    }
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: masterId,
        ownerType: 'MASTER',
        category: 'delivery_report',
        url: input.artifactUrl,
        metadata: { description: input.description } as Prisma.InputJsonValue,
        relatedOrderId: orderId,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'DELIVERED', deliveredAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_DELIVERED',
      payload: { orderId, assetId: asset.id, description: input.description },
      orderId,
    });
    return updated;
  }

  async confirmDelivery(userId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'DELIVERED') {
      throw new ConflictException('订单状态不允许确认收货');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'COMPLETED', completedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_COMPLETED',
      payload: { orderId },
      orderId,
    });
    return updated;
  }

  async disputeOrder(
    userId: string,
    orderId: string,
    input: { reason: string; userStatement: string; evidence: string[] },
  ): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'DELIVERED') {
      throw new ConflictException('订单状态不允许发起异议');
    }
    const dispute = await this.prisma.disputeCase.create({
      data: {
        orderId,
        userId,
        reason: input.reason,
        userStatement: input.userStatement,
        evidence: input.evidence as Prisma.InputJsonValue,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'IN_DISPUTE' },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_DISPUTED',
      payload: { orderId, disputeId: dispute.id },
      orderId,
    });
    return updated;
  }
}
