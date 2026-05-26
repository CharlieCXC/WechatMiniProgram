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

// Safe public field allowlist for getPublicProfile.
// NEVER include phone / unionid / realname / realnameVerified / idNumberHash /
// agreementSignedAt / invitedByUserId — all are sensitive PII/internal.
export const PUBLIC_MASTER_SELECT = {
  id: true,
  displayName: true,
  avatar: true,
  intro: true,
  philosophy: true,
  videoUrl: true,
  experience: true,
  methods: true,
  topics: true,
  badges: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PublicMasterProfile = {
  id: string;
  displayName: string;
  avatar: string;
  intro: string;
  philosophy: string;
  videoUrl: string | null;
  experience: string;
  methods: import('@prisma/client').Prisma.JsonValue;
  topics: import('@prisma/client').Prisma.JsonValue;
  badges: import('@prisma/client').Prisma.JsonValue;
  status: import('@prisma/client').MasterStatus;
  createdAt: Date;
  updatedAt: Date;
};

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

  async getPublicProfile(masterId: string): Promise<PublicMasterProfile> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
      select: PUBLIC_MASTER_SELECT,
    });
    if (!master || master.status !== 'ACTIVE') {
      throw new NotFoundException('师傅不存在或未上架');
    }
    return master;
  }
}
