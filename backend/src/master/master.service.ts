import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Master, MasterStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByPhone(phone: string): Promise<Master> {
    const existing = await this.prisma.master.findUnique({ where: { phone } });
    if (existing) return existing;
    try {
      return await this.prisma.master.create({
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
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const m = await this.prisma.master.findUnique({ where: { phone } });
        if (m) return m;
      }
      throw e;
    }
  }

  async bindUnionid(masterId: string, unionid: string): Promise<Master> {
    try {
      return await this.prisma.master.update({
        where: { id: masterId },
        data: { unionid },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new NotFoundException('师傅不存在');
        }
        if (e.code === 'P2002') {
          throw new ConflictException('该微信已绑定其他师傅账号');
        }
      }
      throw e;
    }
  }
}
