import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PolishProfileInput {
  displayName?: string;
  avatar?: string;
  intro?: string;
  philosophy?: string;
  videoUrl?: string;
  experience?: string;
  methods?: string[];
  topics?: string[];
}

@Injectable()
export class AdminMasterService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMasterOrThrow(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async polishProfile(
    masterId: string,
    input: PolishProfileInput,
  ): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    const allowed = ['INFO_SUBMITTED', 'PROFILE_DRAFTED'];
    if (!allowed.includes(master.onboardingStep)) {
      throw new ConflictException('师傅尚未提交基础信息，无法润色');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { ...input, onboardingStep: 'PROFILE_DRAFTED' },
    });
  }

  async grantBadge(masterId: string, badge: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    const current = Array.isArray(master.badges)
      ? (master.badges as string[])
      : [];
    const badges = current.includes(badge) ? current : [...current, badge];
    return this.prisma.master.update({
      where: { id: masterId },
      data: { badges },
    });
  }

  async activate(masterId: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'SIGNED') {
      throw new ConflictException('师傅未完成签约，无法上架');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'LIVE', status: 'ACTIVE' },
    });
  }
}
