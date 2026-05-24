import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: { master: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { master: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [ProfileService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ProfileService);
  });

  describe('getMyProfile', () => {
    it('returns the master record', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1' });
      expect(await service.getMyProfile('m1')).toEqual({ id: 'm1' });
    });
    it('throws NotFound when missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.getMyProfile('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates allowed presentation fields only', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'PENDING' });
      prisma.master.update.mockResolvedValue({ id: 'm1', displayName: '玄一' });
      const result = await service.updateProfile('m1', {
        displayName: '玄一',
        intro: '专注八字十年',
      });
      expect(result.displayName).toBe('玄一');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { displayName: '玄一', intro: '专注八字十年' },
      });
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(
        service.updateProfile('x', { displayName: 'a' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicProfile', () => {
    it('returns ACTIVE master', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });
      expect(await service.getPublicProfile('m1')).toMatchObject({ id: 'm1' });
    });
    it('throws NotFound for non-ACTIVE master', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'PENDING' });
      await expect(service.getPublicProfile('m1')).rejects.toThrow(
        NotFoundException,
      );
    });
    it('throws NotFound when missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.getPublicProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
