import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master profile (e2e)', () => {
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
        phone: '13900139301',
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
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  const token = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('master gets and updates own profile', async () => {
    const got = await request(app.getHttpServer())
      .get('/masters/me')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(got.body.data.id).toBe(masterId);

    const updated = await request(app.getHttpServer())
      .patch('/masters/me')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        displayName: '玄一道长',
        intro: '专注八字解读十年',
        methods: ['八字'],
      })
      .expect(200);
    expect(updated.body.data.displayName).toBe('玄一道长');
    expect(updated.body.data.methods).toEqual(['八字']);
  });

  it('rejects unknown DTO field (forbidNonWhitelisted)', async () => {
    await request(app.getHttpServer())
      .patch('/masters/me')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'ACTIVE' })
      .expect(400);
  });

  it('public profile hidden until ACTIVE', async () => {
    await request(app.getHttpServer()).get(`/masters/${masterId}`).expect(404);
    await prisma.master.update({
      where: { id: masterId },
      data: { status: 'ACTIVE' },
    });
    const pub = await request(app.getHttpServer())
      .get(`/masters/${masterId}`)
      .expect(200);
    expect(pub.body.data.id).toBe(masterId);
    // PII fields must not leak from the public endpoint
    expect(pub.body.data.phone).toBeUndefined();
    expect(pub.body.data.unionid).toBeUndefined();
    expect(pub.body.data.idNumberHash).toBeUndefined();
  });

  it('GET /masters/me requires MASTER token', async () => {
    await request(app.getHttpServer()).get('/masters/me').expect(401);
  });
});
