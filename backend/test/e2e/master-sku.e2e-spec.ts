import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master SKU (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let masterId: string;

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
        phone: '13900139501',
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
  });

  afterAll(async () => {
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  const token = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('create -> list -> update -> disable', async () => {
    const created = await request(app.getHttpServer())
      .post('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: '八字解读报告',
        type: 'ASYNC_REPORT',
        price: 9900,
        deliveryHour: 48,
        description: '详细书面报告',
      })
      .expect(201);
    const skuId = created.body.data.id as string;
    expect(created.body.data.price).toBe(9900);

    const listed = await request(app.getHttpServer())
      .get('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(listed.body.data.length).toBe(1);

    const updated = await request(app.getHttpServer())
      .patch(`/masters/me/skus/${skuId}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ price: 12900 })
      .expect(200);
    expect(updated.body.data.price).toBe(12900);

    const disabled = await request(app.getHttpServer())
      .delete(`/masters/me/skus/${skuId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(disabled.body.data.status).toBe('DISABLED');
  });

  it('rejects ASYNC_REPORT without deliveryHour (400)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'x',
        type: 'ASYNC_REPORT',
        price: 9900,
        description: 'y',
      })
      .expect(400);
  });

  it('rejects price below 1 (DTO @Min)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'x',
        type: 'REALTIME_IM',
        price: 0,
        durationMin: 30,
        description: 'y',
      })
      .expect(400);
  });

  it('requires MASTER token (401)', async () => {
    await request(app.getHttpServer()).get('/masters/me/skus').expect(401);
  });

  it('rejects REALTIME_IM without durationMin (400)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'x',
        type: 'REALTIME_IM',
        price: 9900,
        description: 'y',
      })
      .expect(400);
  });

  it('prevents IDOR: another master cannot patch or delete this masters sku', async () => {
    // create another master + their own valid SKU on this master
    const other = await prisma.master.create({
      data: {
        phone: '13900139502',
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

    // primary master creates a SKU
    const created = await request(app.getHttpServer())
      .post('/masters/me/skus')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        name: 'IDOR target',
        type: 'ASYNC_REPORT',
        price: 5000,
        deliveryHour: 24,
        description: 'd',
      })
      .expect(201);
    const skuId = created.body.data.id as string;

    // 'other' master tries to PATCH and DELETE — both must 404
    await request(app.getHttpServer())
      .patch(`/masters/me/skus/${skuId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ price: 1 })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/masters/me/skus/${skuId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    // cleanup
    await prisma.serviceSKU.deleteMany({ where: { id: skuId } });
    await prisma.master.deleteMany({ where: { id: other.id } });
  });
});
