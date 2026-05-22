import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: {
    master: { findUnique: jest.Mock; update: jest.Mock };
    inviteCode: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      master: { findUnique: jest.fn(), update: jest.fn() },
      inviteCode: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(OnboardingService);
  });

  describe('redeemInvite', () => {
    it('advances REGISTERED master to INVITED and consumes code', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'UNUSED',
      });
      const txInviteUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const txMasterUpdate = jest
        .fn()
        .mockResolvedValue({ id: 'm1', onboardingStep: 'INVITED' });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          inviteCode: { updateMany: txInviteUpdateMany },
          master: { update: txMasterUpdate },
        }),
      );
      const result = await service.redeemInvite('m1', 'CODE1234');
      expect(result.onboardingStep).toBe('INVITED');
      expect(txInviteUpdateMany).toHaveBeenCalledWith({
        where: { id: 'i1', status: 'UNUSED' },
        data: {
          status: 'USED',
          usedByMasterId: 'm1',
          usedAt: expect.any(Date),
        },
      });
      expect(txMasterUpdate).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { onboardingStep: 'INVITED' },
      });
    });

    it('rejects unknown / non-UNUSED code with BadRequest', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue(null);
      await expect(service.redeemInvite('m1', 'BAD')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when master not at REGISTERED step', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'UNUSED',
      });
      await expect(service.redeemInvite('m1', 'CODE1234')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('submitInfo', () => {
    it('advances INVITED master to INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      const result = await service.submitInfo('m1', {
        experience: '从业十年，师承龙虎山',
        methods: ['八字', '六爻'],
        topics: ['事业咨询'],
      });
      expect(result.onboardingStep).toBe('INFO_SUBMITTED');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: {
          experience: '从业十年，师承龙虎山',
          methods: ['八字', '六爻'],
          topics: ['事业咨询'],
          onboardingStep: 'INFO_SUBMITTED',
        },
      });
    });

    it('allows re-submit when already INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      await expect(
        service.submitInfo('m1', {
          experience: 'x',
          methods: ['塔罗'],
          topics: ['感情咨询'],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects submitInfo when step is REGISTERED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      await expect(
        service.submitInfo('m1', {
          experience: 'x',
          methods: ['塔罗'],
          topics: ['感情咨询'],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signAgreement', () => {
    it('advances PROFILE_DRAFTED master to SIGNED with timestamp', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'SIGNED',
      });
      const result = await service.signAgreement('m1');
      expect(result.onboardingStep).toBe('SIGNED');
      const arg = prisma.master.update.mock.calls[0][0];
      expect(arg.data.onboardingStep).toBe('SIGNED');
      expect(arg.data.agreementSignedAt).toBeInstanceOf(Date);
    });

    it('rejects signAgreement when not at PROFILE_DRAFTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      await expect(service.signAgreement('m1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
