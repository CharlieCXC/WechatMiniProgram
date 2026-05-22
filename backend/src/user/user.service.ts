import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
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
    try {
      return await this.prisma.user.create({
        data: { openid, ...(unionid ? { unionid } : {}) },
      });
    } catch (e) {
      // Race: another concurrent first-login created it between find and create
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const u = await this.prisma.user.findUnique({ where: { openid } });
        if (u) return u;
      }
      throw e;
    }
  }
}
