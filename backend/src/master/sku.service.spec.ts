import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkuService } from './sku.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SkuService', () => {
  let service: SkuService;
  let prisma: {
    serviceSKU: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      serviceSKU: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [SkuService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SkuService);
  });

  describe('create', () => {
    it('creates an ASYNC_REPORT sku with deliveryHour', async () => {
      prisma.serviceSKU.create.mockImplementation(async ({ data }) => ({
        id: 's1',
        ...data,
      }));
      const sku = await service.create('m1', {
        name: '八字解读报告',
        type: 'ASYNC_REPORT',
        price: 9900,
        deliveryHour: 48,
        description: '详细书面报告',
      });
      expect(sku.id).toBe('s1');
      expect(prisma.serviceSKU.create).toHaveBeenCalledWith({
        data: {
          masterId: 'm1',
          name: '八字解读报告',
          type: 'ASYNC_REPORT',
          price: 9900,
          deliveryHour: 48,
          durationMin: null,
          description: '详细书面报告',
        },
      });
    });

    it('creates a REALTIME_IM sku with durationMin', async () => {
      prisma.serviceSKU.create.mockImplementation(async ({ data }) => ({
        id: 's2',
        ...data,
      }));
      const sku = await service.create('m1', {
        name: '30分钟塔罗答疑',
        type: 'REALTIME_IM',
        price: 19900,
        durationMin: 30,
        description: '实时 IM',
      });
      expect(sku.id).toBe('s2');
    });

    it('rejects ASYNC_REPORT without deliveryHour', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'ASYNC_REPORT',
          price: 9900,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects REALTIME_IM without durationMin', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'REALTIME_IM',
          price: 9900,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-positive price', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'ASYNC_REPORT',
          price: 0,
          deliveryHour: 24,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns the master own skus', async () => {
      prisma.serviceSKU.findMany.mockResolvedValue([{ id: 's1' }]);
      const result = await service.list('m1');
      expect(result).toEqual([{ id: 's1' }]);
      expect(prisma.serviceSKU.findMany).toHaveBeenCalledWith({
        where: { masterId: 'm1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('updates a sku owned by the master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'm1',
        type: 'ASYNC_REPORT',
        deliveryHour: 48,
      });
      prisma.serviceSKU.update.mockResolvedValue({ id: 's1', price: 12900 });
      const result = await service.update('m1', 's1', { price: 12900 });
      expect(result.price).toBe(12900);
    });

    it('throws NotFound when sku not owned by master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'other',
        type: 'ASYNC_REPORT',
      });
      await expect(service.update('m1', 's1', { price: 100 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFound when sku missing', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue(null);
      await expect(
        service.update('m1', 'nope', { price: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects non-positive price on update', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'm1',
        type: 'ASYNC_REPORT',
      });
      await expect(service.update('m1', 's1', { price: -5 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects setting durationMin on an ASYNC_REPORT sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'm1',
        type: 'ASYNC_REPORT',
      });
      await expect(
        service.update('m1', 's1', { durationMin: 30 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects setting deliveryHour on a REALTIME_IM sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's2',
        masterId: 'm1',
        type: 'REALTIME_IM',
      });
      await expect(
        service.update('m1', 's2', { deliveryHour: 48 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects clearing required deliveryHour on an ASYNC_REPORT sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'm1',
        type: 'ASYNC_REPORT',
      });
      await expect(
        service.update('m1', 's1', { deliveryHour: 0 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable', () => {
    it('sets status DISABLED for owned sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 's1',
        masterId: 'm1',
      });
      prisma.serviceSKU.update.mockResolvedValue({
        id: 's1',
        status: 'DISABLED',
      });
      const result = await service.disable('m1', 's1');
      expect(result.status).toBe('DISABLED');
      expect(prisma.serviceSKU.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'DISABLED' },
      });
    });
  });
});
