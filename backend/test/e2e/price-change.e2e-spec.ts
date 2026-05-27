import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Price change (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let userId: string;
  let masterId: string;
  let skuId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);

    const user = await prisma.user.create({ data: { openid: 'wx_e2e_pc' } });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139801', status: 'ACTIVE', onboardingStep: 'LIVE',
        displayName: 'x', avatar: '', intro: '', experience: '', philosophy: '',
        methods: ['八字'], topics: ['事业咨询'],
      },
    });
    masterId = master.id;
    const sku = await prisma.serviceSKU.create({
      data: { masterId, name: 'x', type: 'ASYNC_REPORT', price: 9900, deliveryHour: 24, description: 'd' },
    });
    skuId = sku.id;

    // create order and drive it to IN_PROGRESS for propose
    const userTok = jwt.sign({ sub: userId, role: 'USER' });
    const masterTok = jwt.sign({ sub: masterId, role: 'MASTER' });
    const created = await request(app.getHttpServer())
      .post('/orders').set('Authorization', `Bearer ${userTok}`).send({ skuId }).expect(201);
    orderId = created.body.data.id;
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`).set('Authorization', `Bearer ${masterTok}`).expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`).set('Authorization', `Bearer ${userTok}`).expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify').send({ outTradeNo: `STUB_${orderId}` }).expect(200);
  });

  afterAll(async () => {
    await prisma.priceChange.deleteMany({ where: { orderId } });
    const conversations = await prisma.conversation.findMany({ where: { userId, masterId } });
    const convIds = conversations.map(c => c.id);
    if (convIds.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    }
    await prisma.asset.deleteMany({ where: { ownerId: masterId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });
  const masterToken = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('master proposes, user accepts → finalPrice + platformFee updated', async () => {
    const proposed = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/price-changes`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ newPrice: 19900, reason: '需追加八字' })
      .expect(201);
    const pcId = proposed.body.data.id as string;

    const responded = await request(app.getHttpServer())
      .post(`/orders/${orderId}/price-changes/${pcId}/respond`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ decision: 'ACCEPTED' })
      .expect(201);
    expect(responded.body.data.status).toBe('ACCEPTED');
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.finalPrice).toBe(19900);
    expect(order?.platformFee).toBe(1990);
  });

  it('rejects double-propose while PENDING', async () => {
    const p1 = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/price-changes`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ newPrice: 29900, reason: 'x' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/price-changes`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ newPrice: 39900, reason: 'y' })
      .expect(409);
    // cleanup the PENDING one to let following tests use clean state
    await prisma.priceChange.delete({ where: { id: p1.body.data.id } });
  });

  it('user reject → PriceChange REJECTED, order untouched', async () => {
    const proposed = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/price-changes`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ newPrice: 49900, reason: 'x' })
      .expect(201);
    const pcId = proposed.body.data.id;
    const before = await prisma.order.findUnique({ where: { id: orderId } });
    const responded = await request(app.getHttpServer())
      .post(`/orders/${orderId}/price-changes/${pcId}/respond`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ decision: 'REJECTED' })
      .expect(201);
    expect(responded.body.data.status).toBe('REJECTED');
    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after?.finalPrice).toBe(before?.finalPrice);
  });
});
