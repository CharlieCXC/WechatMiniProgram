import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let masterId: string;
  let codeId: string;

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
        phone: '13900139201',
        displayName: '',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: [],
        topics: [],
      },
    });
    masterId = master.id;
    const code = await prisma.inviteCode.create({
      data: { code: 'ONBOARD1' },
    });
    codeId = code.id;
  });

  afterAll(async () => {
    await prisma.inviteCode.deleteMany({ where: { id: codeId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  const token = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('redeem -> submit-info -> (admin drafts) -> sign progresses the funnel', async () => {
    const redeemed = await request(app.getHttpServer())
      .post('/masters/me/onboarding/redeem-invite')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: 'ONBOARD1' })
      .expect(201);
    expect(redeemed.body.data.onboardingStep).toBe('INVITED');

    const info = await request(app.getHttpServer())
      .post('/masters/me/onboarding/submit-info')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        experience: '从业十年',
        methods: ['八字', '六爻'],
        topics: ['事业咨询', '财运分析'],
      })
      .expect(201);
    expect(info.body.data.onboardingStep).toBe('INFO_SUBMITTED');

    await prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'PROFILE_DRAFTED' },
    });

    const signed = await request(app.getHttpServer())
      .post('/masters/me/onboarding/sign')
      .set('Authorization', `Bearer ${token()}`)
      .expect(201);
    expect(signed.body.data.onboardingStep).toBe('SIGNED');
    expect(signed.body.data.agreementSignedAt).toBeTruthy();
  });

  it('rejects redeeming an already-used code', async () => {
    // masterId is now SIGNED; create a fresh REGISTERED master to test used-code rejection
    const other = await prisma.master.create({
      data: {
        phone: '13900139202',
        displayName: '',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: [],
        topics: [],
      },
    });
    const otherToken = jwt.sign({ sub: other.id, role: 'MASTER' });
    await request(app.getHttpServer())
      .post('/masters/me/onboarding/redeem-invite')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ code: 'ONBOARD1' })
      .expect(400);
    await prisma.master.deleteMany({ where: { id: other.id } });
  });

  it('rejects sign without MASTER token (401)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/onboarding/sign')
      .expect(401);
  });
});
