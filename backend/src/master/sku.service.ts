import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceSKU, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSkuInput {
  name: string;
  type: ServiceType;
  price: number;
  durationMin?: number;
  deliveryHour?: number;
  description: string;
}

export interface UpdateSkuInput {
  name?: string;
  price?: number;
  durationMin?: number;
  deliveryHour?: number;
  description?: string;
}

@Injectable()
export class SkuService {
  constructor(private readonly prisma: PrismaService) {}

  async create(masterId: string, input: CreateSkuInput): Promise<ServiceSKU> {
    if (input.price < 1) {
      throw new BadRequestException('价格必须为正整数（单位：分）');
    }
    if (input.type === 'ASYNC_REPORT' && !input.deliveryHour) {
      throw new BadRequestException('异步报告必须设置承诺交付时长 deliveryHour');
    }
    if (input.type === 'REALTIME_IM' && !input.durationMin) {
      throw new BadRequestException('实时 IM 必须设置单次时长 durationMin');
    }
    return this.prisma.serviceSKU.create({
      data: {
        masterId,
        name: input.name,
        type: input.type,
        price: input.price,
        deliveryHour: input.deliveryHour ?? null,
        durationMin: input.durationMin ?? null,
        description: input.description,
      },
    });
  }

  async list(masterId: string): Promise<ServiceSKU[]> {
    return this.prisma.serviceSKU.findMany({
      where: { masterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getOwnedOrThrow(
    masterId: string,
    skuId: string,
  ): Promise<ServiceSKU> {
    const sku = await this.prisma.serviceSKU.findUnique({ where: { id: skuId } });
    if (!sku || sku.masterId !== masterId) {
      throw new NotFoundException('SKU 不存在');
    }
    return sku;
  }

  async update(
    masterId: string,
    skuId: string,
    input: UpdateSkuInput,
  ): Promise<ServiceSKU> {
    await this.getOwnedOrThrow(masterId, skuId);
    if (input.price !== undefined && input.price < 1) {
      throw new BadRequestException('价格必须为正整数（单位：分）');
    }
    return this.prisma.serviceSKU.update({
      where: { id: skuId },
      data: { ...input },
    });
  }

  async disable(masterId: string, skuId: string): Promise<ServiceSKU> {
    await this.getOwnedOrThrow(masterId, skuId);
    return this.prisma.serviceSKU.update({
      where: { id: skuId },
      data: { status: 'DISABLED' },
    });
  }
}
