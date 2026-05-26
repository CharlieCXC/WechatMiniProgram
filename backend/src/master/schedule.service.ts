import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Schedule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateScheduleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    masterId: string,
    input: CreateScheduleInput,
  ): Promise<Schedule> {
    if (input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new BadRequestException('dayOfWeek 必须在 0-6 之间');
    }
    if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
      throw new BadRequestException('时间格式必须为 HH:mm');
    }
    if (input.startTime >= input.endTime) {
      throw new BadRequestException('开始时间必须早于结束时间');
    }
    return this.prisma.schedule.create({
      data: {
        masterId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });
  }

  async list(masterId: string): Promise<Schedule[]> {
    return this.prisma.schedule.findMany({
      where: { masterId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async remove(masterId: string, scheduleId: string): Promise<Schedule> {
    const slot = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
    });
    if (!slot || slot.masterId !== masterId) {
      throw new NotFoundException('排期不存在');
    }
    return this.prisma.schedule.delete({ where: { id: scheduleId } });
  }
}
