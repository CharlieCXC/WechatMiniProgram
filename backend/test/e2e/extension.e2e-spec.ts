import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Extension request (e2e)', () => {
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

    const user = await prisma.user.create({ data: { openid: 'wx_e2e_ext' } });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139901', status: 'ACTIVE', onboardingStep: 'LIVE',
        displayName: 'x', avatar: '', intro: '', experience: '', philosophy: '',
        methods: ['八字'], topics: ['事业咨询'],
      },
    });
    masterId = master.id;
    const sku = await prisma.serviceSKU.create({
      data: { masterId, name: 'x', type: 'ASYNC_REPORT', price: 9900, deliveryHour: 24, description: 'd' },
    });
    skuId = sku.id;

    // drive order to IN_PROGRESS
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
    await prisma.extensionRequest.deleteMany({ where: { orderId } });
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

  it('propose + accept extends deliveryDeadline by 24h', async () => {
    const before = await prisma.order.findUnique({ where: { id: orderId } });
    const proposed = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/extensions`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ additionalHours: 24, reason: '资料补充' })
      .expect(201);
    const exId = proposed.body.data.id;
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/extensions/${exId}/respond`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ decision: 'ACCEPTED' })
      .expect(201);
    const after = await prisma.order.findUnique({ where: { id: orderId } });
    const diff = (after!.deliveryDeadline!.getTime() - before!.deliveryDeadline!.getTime()) / 3600000;
    expect(Math.round(diff)).toBe(24);
  });

  it('rejects out-of-range additionalHours via DTO', async () => {
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/extensions`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ additionalHours: 200, reason: 'x' })
      .expect(400);
  });

  it('rejects propose when there is already a PENDING extension', async () => {
    const p1 = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/extensions`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ additionalHours: 12, reason: 'a' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/extensions`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ additionalHours: 12, reason: 'b' })
      .expect(409);
    await prisma.extensionRequest.delete({ where: { id: p1.body.data.id } });
  });
});
