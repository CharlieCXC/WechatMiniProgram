import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InviteService } from './invite.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InviteService', () => {
  let service: InviteService;
  let prisma: {
    inviteCode: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      inviteCode: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [InviteService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(InviteService);
  });

  it('generate creates an 8-char uppercase code', async () => {
    prisma.inviteCode.create.mockImplementation(async ({ data }) => ({
      id: 'i1',
      ...data,
    }));
    const result = await service.generate('给张师傅');
    expect(result.code).toMatch(/^[0-9A-HJ-NP-Z]{8}$/);
    expect(result.note).toBe('给张师傅');
    expect(prisma.inviteCode.create).toHaveBeenCalled();
  });

  it('list returns codes ordered by createdAt desc', async () => {
    prisma.inviteCode.findMany.mockResolvedValue([{ id: 'i1' }]);
    const result = await service.list();
    expect(result).toEqual([{ id: 'i1' }]);
    expect(prisma.inviteCode.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revoke marks an UNUSED code REVOKED', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue({
      id: 'i1',
      status: 'UNUSED',
    });
    prisma.inviteCode.update.mockResolvedValue({ id: 'i1', status: 'REVOKED' });
    const result = await service.revoke('i1');
    expect(result.status).toBe('REVOKED');
    expect(prisma.inviteCode.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'REVOKED' },
    });
  });

  it('revoke throws NotFound when code missing', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue(null);
    await expect(service.revoke('nope')).rejects.toThrow(NotFoundException);
  });

  it('revoke throws Conflict when code already USED', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue({
      id: 'i1',
      status: 'USED',
    });
    await expect(service.revoke('i1')).rejects.toThrow(ConflictException);
  });

  it('revoke throws Conflict when code already REVOKED', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue({
      id: 'i1',
      status: 'REVOKED',
    });
    await expect(service.revoke('i1')).rejects.toThrow(ConflictException);
  });
});
