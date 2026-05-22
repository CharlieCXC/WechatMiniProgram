import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SubmitInfoInput {
  experience: string;
  methods: string[];
  topics: string[];
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMasterOrThrow(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async redeemInvite(masterId: string, code: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'REGISTERED') {
      throw new ConflictException('当前状态无法兑换邀请码');
    }
    const invite = await this.prisma.inviteCode.findUnique({ where: { code } });
    if (!invite || invite.status !== 'UNUSED') {
      throw new BadRequestException('邀请码无效或已被使用');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.inviteCode.update({
        where: { id: invite.id },
        data: {
          status: 'USED',
          usedByMasterId: masterId,
          usedAt: new Date(),
        },
      });
      return tx.master.update({
        where: { id: masterId },
        data: { onboardingStep: 'INVITED' },
      });
    });
  }

  async submitInfo(masterId: string, input: SubmitInfoInput): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (
      master.onboardingStep !== 'INVITED' &&
      master.onboardingStep !== 'INFO_SUBMITTED'
    ) {
      throw new ConflictException('当前状态无法提交基础信息');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: {
        experience: input.experience,
        methods: input.methods,
        topics: input.topics,
        onboardingStep: 'INFO_SUBMITTED',
      },
    });
  }

  async signAgreement(masterId: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'PROFILE_DRAFTED') {
      throw new ConflictException('请等待资料定稿后再签署');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'SIGNED', agreementSignedAt: new Date() },
    });
  }
}
