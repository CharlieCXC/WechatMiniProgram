import { Injectable } from '@nestjs/common';
import { Master, MasterStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByPhone(phone: string): Promise<Master> {
    const existing = await this.prisma.master.findUnique({ where: { phone } });
    if (existing) return existing;
    return this.prisma.master.create({
      data: {
        phone,
        status: MasterStatus.PENDING,
        displayName: '',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: [],
        topics: [],
      },
    });
  }

  async bindUnionid(masterId: string, unionid: string): Promise<Master> {
    return this.prisma.master.update({
      where: { id: masterId },
      data: { unionid },
    });
  }
}
