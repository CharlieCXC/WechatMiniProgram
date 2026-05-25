import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master schedule (e2e)', () => {
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
        phone: '13900139601',
        displayName: '', avatar: '', intro: '',
        experience: '', philosophy: '', methods: [], topics: [],
      },
    });
    masterId = master.id;
  });

  afterAll(async () => {
    await prisma.schedule.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  const token = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('create -> list -> delete', async () => {
    const created = await request(app.getHttpServer())
      .post('/masters/me/schedules')
      .set('Authorization', `Bearer ${token()}`)
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
      .expect(201);
    const id = created.body.data.id as string;

    const listed = await request(app.getHttpServer())
      .get('/masters/me/schedules')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(listed.body.data.length).toBe(1);

    await request(app.getHttpServer())
      .delete(`/masters/me/schedules/${id}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/masters/me/schedules')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(after.body.data.length).toBe(0);
  });

  it('rejects start >= end (400)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/schedules')
      .set('Authorization', `Bearer ${token()}`)
      .send({ dayOfWeek: 1, startTime: '12:00', endTime: '09:00' })
      .expect(400);
  });

  it('rejects bad time format via DTO (400)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/schedules')
      .set('Authorization', `Bearer ${token()}`)
      .send({ dayOfWeek: 1, startTime: '9am', endTime: '12:00' })
      .expect(400);
  });

  it('requires MASTER token (401)', async () => {
    await request(app.getHttpServer())
      .get('/masters/me/schedules')
      .expect(401);
  });
});
