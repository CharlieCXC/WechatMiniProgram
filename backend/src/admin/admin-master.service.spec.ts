import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdminMasterService } from './admin-master.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminMasterService', () => {
  let service: AdminMasterService;
  let prisma: { master: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { master: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminMasterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminMasterService);
  });

  describe('polishProfile', () => {
    it('updates fields and sets step PROFILE_DRAFTED from INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      const result = await service.polishProfile('m1', { intro: '润色版简介' });
      expect(result.onboardingStep).toBe('PROFILE_DRAFTED');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { intro: '润色版简介', onboardingStep: 'PROFILE_DRAFTED' },
      });
    });

    it('rejects polish when step is before INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      await expect(
        service.polishProfile('m1', { intro: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.polishProfile('x', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('grantBadge', () => {
    it('appends a badge without duplicates', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        badges: ['严选', '专家'],
      });
      const result = await service.grantBadge('m1', '专家');
      expect(result.badges).toEqual(['严选', '专家']);
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { badges: ['严选', '专家'] },
      });
    });

    it('is idempotent when badge already present', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      prisma.master.update.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      const result = await service.grantBadge('m1', '严选');
      expect(result.badges).toEqual(['严选']);
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.grantBadge('x', '严选')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('activate', () => {
    it('sets LIVE + ACTIVE from SIGNED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'SIGNED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'LIVE',
        status: 'ACTIVE',
      });
      const result = await service.activate('m1');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { onboardingStep: 'LIVE', status: 'ACTIVE' },
      });
    });

    it('rejects activate when not SIGNED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      await expect(service.activate('m1')).rejects.toThrow(ConflictException);
    });
  });
});
