import { Injectable } from '@nestjs/common';
import { Conversation, Message } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SystemCardType =
  | 'ORDER_CREATED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'ORDER_PAID'
  | 'ORDER_DELIVERED'
  | 'ORDER_COMPLETED'
  | 'ORDER_DISPUTED'
  | 'PRICE_CHANGE_REQUEST'
  | 'PRICE_CHANGE_DECIDED'
  | 'EXTENSION_REQUEST'
  | 'EXTENSION_DECIDED';

export interface AddSystemCardInput {
  conversationId: string;
  cardType: SystemCardType;
  payload: Record<string, unknown>;
  orderId: string;
}

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(userId: string, masterId: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { userId_masterId: { userId, masterId } },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({ data: { userId, masterId } });
  }

  async addSystemCard(input: AddSystemCardInput): Promise<Message> {
    return this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: 'system',
        senderType: 'SYSTEM',
        type: 'SYSTEM_CARD',
        content: input.cardType,
        systemCardData: input.payload as unknown as import('@prisma/client').Prisma.InputJsonValue,
        relatedOrderId: input.orderId,
        auditStatus: 'PASS',
      },
    });
  }
}
