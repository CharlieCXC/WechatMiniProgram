import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

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
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const sign = (payload: { sub: string; role: 'USER' | 'MASTER' | 'ADMIN' }) =>
    jwt.sign(payload);

  it('GET /auth-test/me returns user info with valid USER token', async () => {
    const token = sign({ sub: 'u_rbac_test', role: 'USER' });
    const resp = await request(app.getHttpServer())
      .get('/auth-test/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resp.body.data).toEqual({ id: 'u_rbac_test', role: 'USER' });
  });

  it('GET /auth-test/me returns 401 without token', async () => {
    await request(app.getHttpServer()).get('/auth-test/me').expect(401);
  });

  it('GET /auth-test/admin-only returns 403 for USER role', async () => {
    const token = sign({ sub: 'u_rbac_test', role: 'USER' });
    await request(app.getHttpServer())
      .get('/auth-test/admin-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /auth-test/admin-only succeeds with ADMIN role', async () => {
    const token = sign({ sub: 'admin_rbac_test', role: 'ADMIN' });
    const resp = await request(app.getHttpServer())
      .get('/auth-test/admin-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resp.body.data).toEqual({ secret: 'only admins see this' });
  });
});
