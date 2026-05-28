import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ExtensionRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

@Injectable()
export class ExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async propose(
    masterId: string,
    orderId: string,
    input: { additionalHours: number; reason: string },
  ): Promise<ExtensionRequest> {
    if (input.additionalHours < 1 || input.additionalHours > 168) {
      throw new BadRequestException('延期小时数必须在 1-168 之间');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    if (order.state !== 'IN_PROGRESS') {
      throw new ConflictException('订单状态不允许申请延期');
    }
    const pending = await this.prisma.extensionRequest.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException('已有未处理的延期申请');
    }
    const created = await this.prisma.extensionRequest.create({
      data: {
        orderId,
        additionalHours: input.additionalHours,
        reason: input.reason,
      },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'EXTENSION_REQUEST',
      payload: {
        orderId,
        extensionId: created.id,
        additionalHours: input.additionalHours,
        reason: input.reason,
      },
      orderId,
    });
    return created;
  }

  async respond(
    userId: string,
    extensionId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<ExtensionRequest> {
    const ext = await this.prisma.extensionRequest.findUnique({
      where: { id: extensionId },
    });
    if (!ext) throw new NotFoundException('延期申请不存在');
    if (ext.status !== 'PENDING') {
      throw new ConflictException('延期申请已被处理');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: ext.orderId },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }

    if (decision === 'ACCEPTED') {
      const newDeadline = order.deliveryDeadline
        ? new Date(
            order.deliveryDeadline.getTime() +
              ext.additionalHours * 3600 * 1000,
          )
        : new Date(Date.now() + ext.additionalHours * 3600 * 1000);
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.extensionRequest.update({
          where: { id: extensionId },
          data: { status: 'ACCEPTED', decidedAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { deliveryDeadline: newDeadline },
        });
        return updated;
      });
      await this.conversation.addSystemCard({
        conversationId: order.conversationId,
        cardType: 'EXTENSION_DECIDED',
        payload: { orderId: order.id, extensionId, decision: 'ACCEPTED' },
        orderId: order.id,
      });
      return result;
    }

    const updated = await this.prisma.extensionRequest.update({
      where: { id: extensionId },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'EXTENSION_DECIDED',
      payload: { orderId: order.id, extensionId, decision: 'REJECTED' },
      orderId: order.id,
    });
    return updated;
  }
}
