import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SmsService } from '../../src/sms/sms.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master phone login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const sentCodes: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue({
        sendVerificationCode: jest.fn(async (phone: string, code: string) => { sentCodes[phone] = code; }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    await prisma.master.deleteMany({ where: { phone: '13900139001' } });
    await redis.del('sms:code:13900139001', 'sms:rate:13900139001');
  });

  afterAll(async () => {
    await prisma.master.deleteMany({ where: { phone: '13900139001' } });
    await redis.del('sms:code:13900139001', 'sms:rate:13900139001');
    await app.close();
  });

  it('full flow: send code -> login -> master record exists', async () => {
    await request(app.getHttpServer()).post('/auth/sms/send').send({ phone: '13900139001' }).expect(200);
    const code = sentCodes['13900139001'];
    expect(code).toMatch(/^\d{6}$/);
    const loginResp = await request(app.getHttpServer()).post('/auth/login/master').send({ phone: '13900139001', code }).expect(200);
    expect(loginResp.body.data).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), userId: expect.any(String) });
    const master = await prisma.master.findUnique({ where: { phone: '13900139001' } });
    expect(master?.status).toBe('PENDING');
  });

  it('rejects wrong code', async () => {
    await redis.set('sms:code:13900139001', '999999', 'EX', 300);
    await request(app.getHttpServer()).post('/auth/login/master').send({ phone: '13900139001', code: '000000' }).expect(400);
  });

  it('rejects bad phone format', async () => {
    await request(app.getHttpServer()).post('/auth/sms/send').send({ phone: '12345' }).expect(400);
  });
});
