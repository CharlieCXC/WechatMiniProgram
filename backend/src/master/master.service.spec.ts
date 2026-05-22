import { Test } from '@nestjs/testing';
import { MasterService } from './master.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MasterService', () => {
  let service: MasterService;
  let prisma: {
    master: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      master: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [MasterService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(MasterService);
  });

  describe('findOrCreateByPhone', () => {
    it('returns existing master', async () => {
      const existing = { id: 'm1', phone: '13800138000' };
      prisma.master.findUnique.mockResolvedValue(existing);
      const r = await service.findOrCreateByPhone('13800138000');
      expect(r).toBe(existing);
    });

    it('creates new master with PENDING status and placeholder profile', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      const created = { id: 'm2', phone: '13800138001' };
      prisma.master.create.mockResolvedValue(created);
      const r = await service.findOrCreateByPhone('13800138001');
      expect(prisma.master.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phone: '13800138001',
          status: 'PENDING',
          displayName: '',
          avatar: '',
          intro: '',
          experience: '',
          philosophy: '',
          methods: [],
          topics: [],
        }),
      });
      expect(r).toBe(created);
    });
  });

  describe('bindUnionid', () => {
    it('updates unionid for given master', async () => {
      const updated = { id: 'm1', unionid: 'wx_uni' };
      prisma.master.update.mockResolvedValue(updated);
      const r = await service.bindUnionid('m1', 'wx_uni');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { unionid: 'wx_uni' },
      });
      expect(r).toBe(updated);
    });
  });
});
