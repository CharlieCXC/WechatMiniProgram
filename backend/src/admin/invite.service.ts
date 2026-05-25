import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { InviteCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Crockford-ish base32 字母表，去掉易混淆字符 I O
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

@Injectable()
export class InviteService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(note?: string): Promise<InviteCode> {
    const code = Array.from({ length: 8 }, () =>
      ALPHABET.charAt(randomInt(0, ALPHABET.length)),
    ).join('');
    return this.prisma.inviteCode.create({
      data: { code, note: note ?? null },
    });
  }

  async list(): Promise<InviteCode[]> {
    return this.prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async revoke(id: string): Promise<InviteCode> {
    const code = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('邀请码不存在');
    if (code.status !== 'UNUSED') {
      throw new ConflictException('仅未使用的邀请码可作废');
    }
    return this.prisma.inviteCode.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
  }
}
