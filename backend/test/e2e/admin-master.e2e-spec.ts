import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Admin invite codes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const createdCodeIds: string[] = [];

  const adminToken = () => jwt.sign({ sub: 'admin_e2e', role: 'ADMIN' });
  const masterToken = () => jwt.sign({ sub: 'master_e2e', role: 'MASTER' });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    if (createdCodeIds.length) {
      await prisma.inviteCode.deleteMany({
        where: { id: { in: createdCodeIds } },
      });
    }
    await app.close();
  });

  it('rejects non-admin (MASTER) with 403', async () => {
    await request(app.getHttpServer())
      .post('/admin/invites')
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({})
      .expect(403);
  });

  it('rejects unauthenticated with 401', async () => {
    await request(app.getHttpServer()).get('/admin/invites').expect(401);
  });

  it('admin generates, lists, then revokes an invite code', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/invites')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ note: 'e2e-test' })
      .expect(201);
    const id = created.body.data.id as string;
    createdCodeIds.push(id);
    expect(created.body.data.code).toMatch(/^[0-9A-HJ-NP-Z]{8}$/);
    expect(created.body.data.status).toBe('UNUSED');

    const listed = await request(app.getHttpServer())
      .get('/admin/invites')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(listed.body.data.some((c: { id: string }) => c.id === id)).toBe(
      true,
    );

    const revoked = await request(app.getHttpServer())
      .delete(`/admin/invites/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(revoked.body.data.status).toBe('REVOKED');
  });
});

describe('Admin master review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let masterId: string;

  const adminToken = () => jwt.sign({ sub: 'admin_e2e2', role: 'ADMIN' });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);

    const master = await prisma.master.create({
      data: {
        phone: '13900139401',
        onboardingStep: 'INFO_SUBMITTED',
        displayName: '',
        avatar: '',
        intro: '',
        experience: '初稿',
        philosophy: '',
        methods: ['八字'],
        topics: ['事业咨询'],
      },
    });
    masterId = master.id;
  });

  afterAll(async () => {
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  it('polish -> sign(simulated) -> grant badge -> activate', async () => {
    const polished = await request(app.getHttpServer())
      .patch(`/admin/masters/${masterId}/profile`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ intro: '资深八字咨询师', philosophy: '以人为本' })
      .expect(200);
    expect(polished.body.data.onboardingStep).toBe('PROFILE_DRAFTED');

    await prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'SIGNED' },
    });

    const badged = await request(app.getHttpServer())
      .post(`/admin/masters/${masterId}/badges`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ badge: '严选' })
      .expect(201);
    expect(badged.body.data.badges).toContain('严选');

    const activated = await request(app.getHttpServer())
      .post(`/admin/masters/${masterId}/activate`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(201);
    expect(activated.body.data.status).toBe('ACTIVE');
    expect(activated.body.data.onboardingStep).toBe('LIVE');
  });

  it('rejects activate before SIGNED with 409', async () => {
    const m = await prisma.master.create({
      data: {
        phone: '13900139402',
        onboardingStep: 'PROFILE_DRAFTED',
        displayName: '',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: [],
        topics: [],
      },
    });
    await request(app.getHttpServer())
      .post(`/admin/masters/${m.id}/activate`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(409);
    await prisma.master.deleteMany({ where: { id: m.id } });
  });
});
