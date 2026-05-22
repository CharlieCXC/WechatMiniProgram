import { Test } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UserService);
  });

  describe('findOrCreateByOpenid', () => {
    it('returns existing user when openid matches', async () => {
      const existing = { id: 'u1', openid: 'wx_abc', unionid: null };
      prisma.user.findUnique.mockResolvedValue(existing);
      const result = await service.findOrCreateByOpenid('wx_abc');
      expect(result).toBe(existing);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates new user when openid is new', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = { id: 'u_new', openid: 'wx_new', unionid: null };
      prisma.user.create.mockResolvedValue(created);
      const result = await service.findOrCreateByOpenid('wx_new');
      expect(result).toBe(created);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { openid: 'wx_new' },
      });
    });

    it('updates unionid if provided and missing on existing user', async () => {
      const existing = { id: 'u1', openid: 'wx_abc', unionid: null };
      prisma.user.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, unionid: 'wx_uni' };
      prisma.user.update.mockResolvedValue(updated);
      const result = await service.findOrCreateByOpenid('wx_abc', 'wx_uni');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { unionid: 'wx_uni' },
      });
      expect(result).toBe(updated);
    });
  });
});
