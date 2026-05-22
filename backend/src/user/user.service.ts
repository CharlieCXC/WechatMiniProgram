import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByOpenid(openid: string, unionid?: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { openid } });
    if (existing) {
      if (unionid && !existing.unionid) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { unionid },
        });
      }
      return existing;
    }
    return this.prisma.user.create({
      data: { openid, ...(unionid ? { unionid } : {}) },
    });
  }
}
