import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Admin invite codes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const createdCodeIds: string[] = [];

  const adminToken = () => jwt.sign({ sub: 'admin_e2e', role: 'ADMIN' });
  const masterToken = () => jwt.sign({ sub: 'master_e2e', role: 'MASTER' });

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
  });

  afterAll(async () => {
    if (createdCodeIds.length) {
      await prisma.inviteCode.deleteMany({
        where: { id: { in: createdCodeIds } },
      });
    }
    await app.close();
  });

  it('rejects non-admin (MASTER) with 403', async () => {
    await request(app.getHttpServer())
      .post('/admin/invites')
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({})
      .expect(403);
  });

  it('rejects unauthenticated with 401', async () => {
    await request(app.getHttpServer()).get('/admin/invites').expect(401);
  });

  it('admin generates, lists, then revokes an invite code', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/invites')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ note: 'e2e-test' })
      .expect(201);
    const id = created.body.data.id as string;
    createdCodeIds.push(id);
    expect(created.body.data.code).toMatch(/^[0-9A-HJ-NP-Z]{8}$/);
    expect(created.body.data.status).toBe('UNUSED');

    const listed = await request(app.getHttpServer())
      .get('/admin/invites')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(listed.body.data.some((c: { id: string }) => c.id === id)).toBe(true);

    const revoked = await request(app.getHttpServer())
      .delete(`/admin/invites/${id}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(revoked.body.data.status).toBe('REVOKED');
  });
});
