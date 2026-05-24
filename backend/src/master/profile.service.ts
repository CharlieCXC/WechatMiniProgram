import { Injectable, NotFoundException } from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateProfileInput {
  displayName?: string;
  avatar?: string;
  intro?: string;
  philosophy?: string;
  videoUrl?: string;
  methods?: string[];
  topics?: string[];
  experience?: string;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async updateProfile(
    masterId: string,
    input: UpdateProfileInput,
  ): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return this.prisma.master.update({
      where: { id: masterId },
      data: { ...input },
    });
  }

  async getPublicProfile(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master || master.status !== 'ACTIVE') {
      throw new NotFoundException('师傅不存在或未上架');
    }
    return master;
  }
}
