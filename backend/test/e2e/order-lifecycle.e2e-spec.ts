import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Order lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let userId: string;
  let masterId: string;
  let skuId: string;
  let conversationId: string;

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
      data: { openid: 'wx_e2e_order_u' },
    });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139701',
        status: 'ACTIVE',
        onboardingStep: 'LIVE',
        displayName: '玄一',
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
        name: '八字解读报告',
        type: 'ASYNC_REPORT',
        price: 9900,
        deliveryHour: 48,
        description: '完整书面报告',
      },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    // cleanup in FK-safe order: messages → assets → orders → conversation → sku → master → user
    if (conversationId) {
      await prisma.message.deleteMany({ where: { conversationId } });
    }
    await prisma.asset.deleteMany({ where: { ownerId: masterId } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });

  it('full happy path: create → (master accept via DB) → pay → notify → deliver(DB) → confirm', async () => {
    // create
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    expect(created.body.data.state).toBe('PENDING_ACCEPT');
    expect(created.body.data.platformFee).toBe(990);
    conversationId = created.body.data.conversationId;

    // master accept via DB (master controller comes in Task 12)
    await prisma.order.update({
      where: { id: orderId },
      data: { state: 'ACCEPTED', acceptedAt: new Date() },
    });

    // user pay
    const payResp = await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(payResp.body.data.paymentIntent.prepayId).toBe(
      `STUB_PREPAY_${orderId}`,
    );
    expect(payResp.body.data.order.state).toBe('PENDING_PAYMENT');

    // notify (no auth)
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: `STUB_${orderId}` })
      .expect(200);
    const afterPay = await prisma.order.findUnique({ where: { id: orderId } });
    expect(afterPay?.state).toBe('IN_PROGRESS');
    expect(afterPay?.deliveryDeadline).toBeInstanceOf(Date);

    // master deliver via DB (master controller comes in Task 12)
    await prisma.order.update({
      where: { id: orderId },
      data: { state: 'DELIVERED', deliveredAt: new Date() },
    });

    // user confirm
    const confirmed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(confirmed.body.data.state).toBe('COMPLETED');
  });

  it('cancel from PENDING_ACCEPT → CANCELLED', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const cancelled = await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(cancelled.body.data.state).toBe('CANCELLED');
  });

  it('payment notify with invalid trade no returns 400', async () => {
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: 'NOT_STUB_FORMAT' })
      .expect(400);
  });

  it('rejects USER endpoint without USER role (401)', async () => {
    await request(app.getHttpServer()).get('/orders').expect(401);
  });
});
