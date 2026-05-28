import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master order endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let userId: string;
  let masterId: string;
  let skuId: string;

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

    const user = await prisma.user.create({
      data: { openid: 'wx_e2e_morder_u' },
    });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139702',
        status: 'ACTIVE',
        onboardingStep: 'LIVE',
        displayName: 'x',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: ['八字'],
        topics: ['事业咨询'],
      },
    });
    masterId = master.id;
    const sku = await prisma.serviceSKU.create({
      data: {
        masterId,
        name: 'x',
        type: 'ASYNC_REPORT',
        price: 9900,
        deliveryHour: 24,
        description: 'd',
      },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    // FK-safe cleanup: find all conversation ids for this pair first
    const conversations = await prisma.conversation.findMany({
      where: { userId, masterId },
    });
    const convIds = conversations.map((c) => c.id);
    if (convIds.length) {
      await prisma.message.deleteMany({
        where: { conversationId: { in: convIds } },
      });
    }
    await prisma.asset.deleteMany({ where: { ownerId: masterId } });
    await prisma.order.deleteMany({ where: { masterId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });
  const masterToken = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('master accepts an order, user pays + notify, master delivers via endpoint, user confirms', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;

    const accepted = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .expect(201);
    expect(accepted.body.data.state).toBe('ACCEPTED');

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: `STUB_${orderId}` })
      .expect(200);

    const delivered = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({
        artifactUrl: 'https://cos.example.com/r.pdf',
        description: '完整报告',
      })
      .expect(201);
    expect(delivered.body.data.state).toBe('DELIVERED');

    const confirmed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(confirmed.body.data.state).toBe('COMPLETED');
  });

  it('master rejects an order with reason → CANCELLED', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const rejected = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/reject`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ reason: '日程不便' })
      .expect(201);
    expect(rejected.body.data.state).toBe('CANCELLED');
  });

  it("master cannot accept another master's order (IDOR → 404)", async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const otherMaster = await prisma.master.create({
      data: {
        phone: '13900139703',
        status: 'ACTIVE',
        onboardingStep: 'LIVE',
        displayName: 'y',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: ['塔罗'],
        topics: ['感情咨询'],
      },
    });
    const otherToken = jwt.sign({ sub: otherMaster.id, role: 'MASTER' });
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await prisma.master.deleteMany({ where: { id: otherMaster.id } });
  });
});
