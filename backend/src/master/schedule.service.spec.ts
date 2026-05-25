import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let prisma: {
    schedule: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      schedule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ScheduleService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ScheduleService);
  });

  describe('create', () => {
    it('creates a valid schedule slot', async () => {
      prisma.schedule.create.mockImplementation(async ({ data }) => ({
        id: 'sc1',
        ...data,
      }));
      const result = await service.create('m1', {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '12:00',
      });
      expect(result.id).toBe('sc1');
      expect(prisma.schedule.create).toHaveBeenCalledWith({
        data: { masterId: 'm1', dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
      });
    });

    it('rejects when startTime >= endTime', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bad time format', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 1, startTime: '9am', endTime: '12:00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dayOfWeek out of range', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 7, startTime: '09:00', endTime: '12:00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns master schedules ordered by day then start', async () => {
      prisma.schedule.findMany.mockResolvedValue([{ id: 'sc1' }]);
      const result = await service.list('m1');
      expect(result).toEqual([{ id: 'sc1' }]);
      expect(prisma.schedule.findMany).toHaveBeenCalledWith({
        where: { masterId: 'm1' },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  });

  describe('remove', () => {
    it('deletes a slot owned by the master', async () => {
      prisma.schedule.findUnique.mockResolvedValue({ id: 'sc1', masterId: 'm1' });
      prisma.schedule.delete.mockResolvedValue({ id: 'sc1' });
      const result = await service.remove('m1', 'sc1');
      expect(result).toEqual({ id: 'sc1' });
      expect(prisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 'sc1' } });
    });

    it('throws NotFound when slot not owned', async () => {
      prisma.schedule.findUnique.mockResolvedValue({ id: 'sc1', masterId: 'other' });
      await expect(service.remove('m1', 'sc1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when slot missing', async () => {
      prisma.schedule.findUnique.mockResolvedValue(null);
      await expect(service.remove('m1', 'x')).rejects.toThrow(NotFoundException);
    });
  });
});
