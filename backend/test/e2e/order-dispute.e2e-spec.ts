import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Order dispute (e2e)', () => {
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
      data: { openid: 'wx_e2e_dispute_u' },
    });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139950',
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
    const orders = await prisma.order.findMany({ where: { userId } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      await prisma.disputeCase.deleteMany({
        where: { orderId: { in: orderIds } },
      });
    }
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
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });
  const masterToken = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  async function driveOrderToDelivered(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: `STUB_${orderId}` })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({
        artifactUrl: 'https://cos.example.com/r.pdf',
        description: '完整报告',
      })
      .expect(201);
    return orderId;
  }

  it('user disputes a DELIVERED order → IN_DISPUTE + DisputeCase row + system card', async () => {
    const orderId = await driveOrderToDelivered();
    const disputed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/dispute`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({
        reason: '交付物简陋',
        userStatement: '只发了一段语音，没有正式报告',
        evidence: ['https://cos.example/evidence1.png'],
      })
      .expect(201);
    expect(disputed.body.data.state).toBe('IN_DISPUTE');

    const dispute = await prisma.disputeCase.findUnique({ where: { orderId } });
    expect(dispute).not.toBeNull();
    expect(dispute?.reason).toBe('交付物简陋');
    expect(dispute?.userStatement).toBe('只发了一段语音，没有正式报告');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    const messages = await prisma.message.findMany({
      where: { conversationId: order!.conversationId, type: 'SYSTEM_CARD' },
    });
    const disputeCard = messages.find((m) => m.content === 'ORDER_DISPUTED');
    expect(disputeCard).toBeDefined();
  });

  it('rejects dispute via DTO validation (reason missing)', async () => {
    const orderId = await driveOrderToDelivered();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/dispute`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({
        userStatement: 'x',
        evidence: [],
      })
      .expect(400);
  });

  it('rejects dispute on a COMPLETED order (409)', async () => {
    // create a fresh order and drive to COMPLETED
    const orderId = await driveOrderToDelivered();
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/dispute`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ reason: 'x', userStatement: 'y', evidence: [] })
      .expect(409);
  });
});
