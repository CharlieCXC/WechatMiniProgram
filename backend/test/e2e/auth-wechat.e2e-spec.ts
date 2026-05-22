import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { WechatService } from '../../src/wechat/wechat.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('POST /auth/login/wechat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WechatService)
      .useValue({
        code2Session: jest.fn().mockResolvedValue({ openid: 'e2e_openid_test', sessionKey: 'sk', unionid: 'e2e_unionid_test' }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.user.deleteMany({ where: { openid: 'e2e_openid_test' } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { openid: 'e2e_openid_test' } });
    await app.close();
  });

  it('returns access + refresh tokens for valid code', async () => {
    const resp = await request(app.getHttpServer())
      .post('/auth/login/wechat')
      .send({ code: 'mock_code' })
      .expect(200);
    expect(resp.body).toMatchObject({
      success: true,
      data: { accessToken: expect.any(String), refreshToken: expect.any(String), userId: expect.any(String) },
    });
    const created = await prisma.user.findUnique({ where: { openid: 'e2e_openid_test' } });
    expect(created).toBeTruthy();
    expect(created?.unionid).toBe('e2e_unionid_test');
  });

  it('rejects when code is missing', async () => {
    await request(app.getHttpServer()).post('/auth/login/wechat').send({}).expect(400);
  });
});
