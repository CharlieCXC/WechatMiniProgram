# 师傅供给端（后端）Implementation Plan — Plan 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已落地的 NestJS+Prisma 后端地基上，实现「师傅供给端」的全部后端 API：邀请码、入驻状态机、师傅 Profile、服务 SKU、可预约排期，以及创始人（ADMIN）手动审核/润色/上架端点。

**Architecture:** 纯后端，沿用现有 NestJS 模块化 + Prisma + RBAC 模式。师傅供给域归入扩展后的 `MasterModule`（师傅自助端点），创始人审核归入新建的 `AdminModule`（ADMIN-only 端点）。入驻是一条线性状态机：`REGISTERED → INVITED → INFO_SUBMITTED → PROFILE_DRAFTED → SIGNED → LIVE`。实名核身 / 视频转写 / AI 抽取按既定决策**不在本计划内**——创始人线下访谈手动整理，本计划只提供承载这些结果的后台录入端点。H5 React 前端是独立的 Plan 2.5，不在此计划。

**Tech Stack:** Node 22 + NestJS 10 + TypeScript + Prisma 6（MySQL 8）+ Redis 7 + Jest + supertest + pnpm 11.1.3。

---

## Conventions（全计划通用，必须遵守）

- **金额单位**：所有金额字段一律为 **分（RMB cents）**。引导价 ¥99 = `9900`。`ServiceSKU.price` 为 `Int`（分），校验 `price >= 1`。
- **方式/事项词表**：`Master.methods` / `Master.topics` 为 `Json`（字符串数组），创始人策展的自由词表（参考值：方式=八字/塔罗/六爻/紫微/起名；事项=感情咨询/事业咨询/财运分析/健康咨询/求子咨询/决策探讨/起名/流年）。DTO 校验：非空数组、每项为字符串、每项 ≤20 字、数组 ≤10 项。
- **响应包络**：全局 `ResponseInterceptor` 把返回值包成 `{ data: <payload> }`。E2E 断言读 `resp.body.data`。
- **鉴权**：
  - 师傅 token：`sub = master.id`，`role = 'MASTER'`。师傅自助端点用 `@CurrentUser().id` 当 `masterId`。
  - ADMIN token：MVP 阶段没有 admin 登录流程，创始人用「手动签发 / 后续 seed」的 JWT。本计划的 E2E 测试用 `JwtService.sign({ sub, role:'ADMIN' })` 直接铸造（与现有 `rbac.e2e-spec.ts` 一致）。**不在本计划构建 admin 登录**（YAGNI）。
- **Prisma 错误映射**：`P2025`（记录不存在）→ `NotFoundException`(404)；`P2002`（唯一冲突）→ `ConflictException`(409)。沿用 `master.service.ts` 既有写法。
- **守卫写法**：受保护端点用 `@UseGuards(AuthGuard('jwt'), RolesGuard)` + `@Roles('MASTER')` 或 `@Roles('ADMIN')`，并加 `@ApiBearerAuth()`。
- **PrismaModule 为 @Global**：新服务直接构造注入 `PrismaService`，无需在自己模块 import `PrismaModule`。
- **运行环境（每次跑测试前 export 一次）**：
  ```bash
  export PATH="$HOME/Library/pnpm/bin:$PATH"   # pnpm 11.1.3 不在默认 PATH
  cd backend
  ```
  docker 服务（mysql:3307→容器3306 / redis:6379）须 healthy：`docker compose -f docker-compose.dev.yml ps`。
- **本地 `.env` 已存在**（含 `DATABASE_URL`），单测/E2E 直接可跑。

---

## File Structure

```
backend/prisma/schema.prisma                       # 修改：+InviteCode 模型、+2 枚举、Master +2 字段
backend/prisma/migrations/<ts>_master_supply/      # 新增迁移

backend/src/master/
  master.module.ts          # 修改：注册新 controllers + services（保持 exports: [MasterService]）
  master.service.ts         # 不改（findOrCreateByPhone / bindUnionid 保持）
  profile.service.ts        # 新增：师傅 Profile 读/写 + 公开读
  profile.service.spec.ts   # 新增
  master.controller.ts      # 新增：/masters（公开读）+ /masters/me（师傅自助 profile）
  onboarding.service.ts     # 新增：兑换邀请码 / 提交基础信息 / 签约（状态机推进）
  onboarding.service.spec.ts# 新增
  onboarding.controller.ts  # 新增：/masters/me/onboarding/*
  sku.service.ts            # 新增：SKU CRUD（跨字段校验）
  sku.service.spec.ts       # 新增
  sku.controller.ts         # 新增：/masters/me/skus
  schedule.service.ts       # 新增：排期 CRUD
  schedule.service.spec.ts  # 新增
  schedule.controller.ts    # 新增：/masters/me/schedules
  dto/
    update-profile.dto.ts
    submit-info.dto.ts
    redeem-invite.dto.ts
    create-sku.dto.ts
    update-sku.dto.ts
    create-schedule.dto.ts
    update-schedule.dto.ts

backend/src/admin/
  admin.module.ts           # 新增
  invite.service.ts         # 新增：生成/列出/作废邀请码
  invite.service.spec.ts    # 新增
  admin-master.service.ts   # 新增：润色 profile / 授予徽章 / 上架
  admin-master.service.spec.ts # 新增
  admin.controller.ts       # 新增：/admin/*（ADMIN-only）
  dto/
    create-invite.dto.ts
    polish-profile.dto.ts
    grant-badge.dto.ts

backend/src/app.module.ts   # 修改：imports += MasterModule, AdminModule

backend/test/e2e/
  onboarding.e2e-spec.ts    # 新增
  master-profile.e2e-spec.ts# 新增
  master-sku.e2e-spec.ts    # 新增
  master-schedule.e2e-spec.ts # 新增
  admin-master.e2e-spec.ts  # 新增
```

---

## 入驻状态机（权威定义）

```
REGISTERED          # 手机号登录后默认（findOrCreateByPhone 创建）
   │ redeemInvite（师傅输入有效邀请码）
   ▼
INVITED
   │ submitInfo（师傅提交：从业经历/师承、擅长方式、擅长事项）
   ▼
INFO_SUBMITTED
   │ adminPolishProfile（创始人线下访谈后，后台录入/润色完整 profile）
   ▼
PROFILE_DRAFTED
   │ signAgreement（师傅在线签《平台公约》）
   ▼
SIGNED
   │ adminActivate（创始人终审上架：onboardingStep=LIVE, status=ACTIVE）
   ▼
LIVE
```

每个转换都校验「当前必须处于上一步」，否则抛 `ConflictException`（409）。

---

### Task 1: Schema — 邀请码模型 + 入驻枚举 + Master 入驻字段 + 迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_master_supply/migration.sql`（由 prisma 生成）

- [ ] **Step 1: 修改 schema.prisma — Master 模型加两个字段**

在 `model Master { ... }` 内，`idNumberHash String?` 之后、`displayName` 之前，新增：

```prisma
  onboardingStep    MasterOnboardingStep @default(REGISTERED)
  agreementSignedAt DateTime?
```

并在 `model Master` 的关系区（`settlements Settlement[]` 之后）新增反向关系：

```prisma
  inviteCode  InviteCode?
```

- [ ] **Step 2: 修改 schema.prisma — 新增 MasterOnboardingStep 枚举**

在 `enum MasterStatus { ... }` 之后新增：

```prisma
enum MasterOnboardingStep {
  REGISTERED
  INVITED
  INFO_SUBMITTED
  PROFILE_DRAFTED
  SIGNED
  LIVE
}
```

- [ ] **Step 3: 修改 schema.prisma — 新增 InviteCode 模型与枚举**

在 `// ============= USERS & MASTERS =============` 区块末尾（`enum MasterOnboardingStep` 之后）新增：

```prisma
model InviteCode {
  id             String           @id @default(cuid())
  code           String           @unique
  note           String?          @db.VarChar(200)
  status         InviteCodeStatus @default(UNUSED)
  usedByMasterId String?          @unique
  usedByMaster   Master?          @relation(fields: [usedByMasterId], references: [id])
  createdAt      DateTime         @default(now())
  usedAt         DateTime?

  @@map("invite_codes")
}

enum InviteCodeStatus {
  UNUSED
  USED
  REVOKED
}
```

- [ ] **Step 4: 生成并应用迁移**

Run:
```bash
export PATH="$HOME/Library/pnpm/bin:$PATH" && cd backend
pnpm exec prisma migrate dev --name master_supply
```
Expected: 新建 `prisma/migrations/<ts>_master_supply/`，输出 `Your database is now in sync with your schema.`，并自动重新生成 Prisma Client。

- [ ] **Step 5: 验证类型生成**

Run:
```bash
pnpm exec prisma generate && pnpm exec tsc --noEmit
```
Expected: 无错误（`MasterOnboardingStep`、`InviteCode`、`InviteCodeStatus` 已进入 `@prisma/client`）。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(backend): add invite code + onboarding step models

Refs #5 #6"
```

---

### Task 2: InviteService — 生成/列出/作废邀请码

**Files:**
- Create: `backend/src/admin/invite.service.ts`
- Test: `backend/src/admin/invite.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/admin/invite.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InviteService } from './invite.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InviteService', () => {
  let service: InviteService;
  let prisma: {
    inviteCode: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      inviteCode: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [InviteService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(InviteService);
  });

  it('generate creates an 8-char uppercase code', async () => {
    prisma.inviteCode.create.mockImplementation(async ({ data }) => ({
      id: 'i1',
      ...data,
    }));
    const result = await service.generate('给张师傅');
    expect(result.code).toMatch(/^[0-9A-HJ-NP-Z]{8}$/);
    expect(result.note).toBe('给张师傅');
    expect(prisma.inviteCode.create).toHaveBeenCalled();
  });

  it('list returns codes ordered by createdAt desc', async () => {
    prisma.inviteCode.findMany.mockResolvedValue([{ id: 'i1' }]);
    const result = await service.list();
    expect(result).toEqual([{ id: 'i1' }]);
    expect(prisma.inviteCode.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revoke marks an UNUSED code REVOKED', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue({ id: 'i1', status: 'UNUSED' });
    prisma.inviteCode.update.mockResolvedValue({ id: 'i1', status: 'REVOKED' });
    const result = await service.revoke('i1');
    expect(result.status).toBe('REVOKED');
    expect(prisma.inviteCode.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'REVOKED' },
    });
  });

  it('revoke throws NotFound when code missing', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue(null);
    await expect(service.revoke('nope')).rejects.toThrow(NotFoundException);
  });

  it('revoke throws Conflict when code already USED', async () => {
    prisma.inviteCode.findUnique.mockResolvedValue({ id: 'i1', status: 'USED' });
    await expect(service.revoke('i1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- invite.service`
Expected: FAIL（`Cannot find module './invite.service'`）。

- [ ] **Step 3: 实现 InviteService**

`backend/src/admin/invite.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { InviteCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Crockford-ish base32 字母表，去掉易混淆字符 I O
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

@Injectable()
export class InviteService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(note?: string): Promise<InviteCode> {
    const code = Array.from({ length: 8 }, () =>
      ALPHABET.charAt(randomInt(0, ALPHABET.length)),
    ).join('');
    return this.prisma.inviteCode.create({ data: { code, note: note ?? null } });
  }

  async list(): Promise<InviteCode[]> {
    return this.prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async revoke(id: string): Promise<InviteCode> {
    const code = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('邀请码不存在');
    if (code.status !== 'UNUSED') {
      throw new ConflictException('仅未使用的邀请码可作废');
    }
    return this.prisma.inviteCode.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
  }
}
```

> 注：测试里的正则 `^[0-9A-HJ-NP-Z]{8}$` 与 `ALPHABET`（去掉 I、O）一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- invite.service`
Expected: PASS（5 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/admin/invite.service.ts src/admin/invite.service.spec.ts
git commit -m "feat(backend): add InviteService (generate/list/revoke)

Refs #6"
```

---

### Task 3: AdminModule + admin.controller 邀请码端点 + E2E

**Files:**
- Create: `backend/src/admin/dto/create-invite.dto.ts`
- Create: `backend/src/admin/admin.controller.ts`
- Create: `backend/src/admin/admin.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/e2e/admin-master.e2e-spec.ts`（本任务先建文件，仅测邀请码部分；Task 9 会追加 master 审核用例）

- [ ] **Step 1: 写 DTO**

`backend/src/admin/dto/create-invite.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiPropertyOptional({ description: '备注：邀请给谁' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
```

- [ ] **Step 2: 写 admin.controller（先只放邀请码端点）**

`backend/src/admin/admin.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InviteService } from './invite.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly invites: InviteService) {}

  @Post('invites')
  @ApiOperation({ summary: '生成邀请码' })
  createInvite(@Body() dto: CreateInviteDto) {
    return this.invites.generate(dto.note);
  }

  @Get('invites')
  @ApiOperation({ summary: '列出全部邀请码' })
  listInvites() {
    return this.invites.list();
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: '作废一个未使用的邀请码' })
  revokeInvite(@Param('id') id: string) {
    return this.invites.revoke(id);
  }
}
```

- [ ] **Step 3: 写 admin.module**

`backend/src/admin/admin.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { InviteService } from './invite.service';

@Module({
  controllers: [AdminController],
  providers: [InviteService],
})
export class AdminModule {}
```

- [ ] **Step 4: 在 AppModule 注册 AdminModule**

修改 `backend/src/app.module.ts`，import 并加入 `imports` 数组：

```typescript
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    AdminModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: 写 E2E（邀请码全流程 + RBAC）**

`backend/test/e2e/admin-master.e2e-spec.ts`:

```typescript
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
```

- [ ] **Step 6: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json admin-master`
Expected: PASS（3 tests）。

> 注：NestJS `@Post` 默认返回 201，`@Get`/`@Delete` 默认 200，故测试分别 expect 201/200/200。

- [ ] **Step 7: Commit**

```bash
git add src/admin/dto/create-invite.dto.ts src/admin/admin.controller.ts src/admin/admin.module.ts src/app.module.ts test/e2e/admin-master.e2e-spec.ts
git commit -m "feat(backend): admin invite code endpoints + e2e

Refs #6"
```

---

### Task 4: OnboardingService — 兑换邀请码 / 提交基础信息 / 签约

**Files:**
- Create: `backend/src/master/onboarding.service.ts`
- Test: `backend/src/master/onboarding.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/master/onboarding.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: {
    master: { findUnique: jest.Mock; update: jest.Mock };
    inviteCode: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      master: { findUnique: jest.fn(), update: jest.fn() },
      inviteCode: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(OnboardingService);
  });

  describe('redeemInvite', () => {
    it('advances REGISTERED master to INVITED and consumes code', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'UNUSED',
      });
      prisma.$transaction.mockImplementation(async (fns) => {
        // emulate transaction: call the callback with a tx client
        if (typeof fns === 'function') {
          return fns({
            inviteCode: { update: jest.fn() },
            master: {
              update: jest.fn().mockResolvedValue({
                id: 'm1',
                onboardingStep: 'INVITED',
              }),
            },
          });
        }
        return Promise.all(fns);
      });
      const result = await service.redeemInvite('m1', 'CODE1234');
      expect(result.onboardingStep).toBe('INVITED');
    });

    it('rejects unknown / non-UNUSED code with BadRequest', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue(null);
      await expect(service.redeemInvite('m1', 'BAD')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when master not at REGISTERED step', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      prisma.inviteCode.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'UNUSED',
      });
      await expect(service.redeemInvite('m1', 'CODE1234')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('submitInfo', () => {
    it('advances INVITED master to INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      const result = await service.submitInfo('m1', {
        experience: '从业十年，师承龙虎山',
        methods: ['八字', '六爻'],
        topics: ['事业咨询'],
      });
      expect(result.onboardingStep).toBe('INFO_SUBMITTED');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: {
          experience: '从业十年，师承龙虎山',
          methods: ['八字', '六爻'],
          topics: ['事业咨询'],
          onboardingStep: 'INFO_SUBMITTED',
        },
      });
    });

    it('allows re-submit when already INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      await expect(
        service.submitInfo('m1', {
          experience: 'x',
          methods: ['塔罗'],
          topics: ['感情咨询'],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects submitInfo when step is REGISTERED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'REGISTERED',
      });
      await expect(
        service.submitInfo('m1', {
          experience: 'x',
          methods: ['塔罗'],
          topics: ['感情咨询'],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signAgreement', () => {
    it('advances PROFILE_DRAFTED master to SIGNED with timestamp', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'SIGNED',
      });
      const result = await service.signAgreement('m1');
      expect(result.onboardingStep).toBe('SIGNED');
      const arg = prisma.master.update.mock.calls[0][0];
      expect(arg.data.onboardingStep).toBe('SIGNED');
      expect(arg.data.agreementSignedAt).toBeInstanceOf(Date);
    });

    it('rejects signAgreement when not at PROFILE_DRAFTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      await expect(service.signAgreement('m1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- onboarding.service`
Expected: FAIL（`Cannot find module './onboarding.service'`）。

- [ ] **Step 3: 实现 OnboardingService**

`backend/src/master/onboarding.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SubmitInfoInput {
  experience: string;
  methods: string[];
  topics: string[];
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMasterOrThrow(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async redeemInvite(masterId: string, code: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'REGISTERED') {
      throw new ConflictException('当前状态无法兑换邀请码');
    }
    const invite = await this.prisma.inviteCode.findUnique({ where: { code } });
    if (!invite || invite.status !== 'UNUSED') {
      throw new BadRequestException('邀请码无效或已被使用');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.inviteCode.update({
        where: { id: invite.id },
        data: {
          status: 'USED',
          usedByMasterId: masterId,
          usedAt: new Date(),
        },
      });
      return tx.master.update({
        where: { id: masterId },
        data: { onboardingStep: 'INVITED' },
      });
    });
  }

  async submitInfo(masterId: string, input: SubmitInfoInput): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (
      master.onboardingStep !== 'INVITED' &&
      master.onboardingStep !== 'INFO_SUBMITTED'
    ) {
      throw new ConflictException('当前状态无法提交基础信息');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: {
        experience: input.experience,
        methods: input.methods,
        topics: input.topics,
        onboardingStep: 'INFO_SUBMITTED',
      },
    });
  }

  async signAgreement(masterId: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'PROFILE_DRAFTED') {
      throw new ConflictException('请等待资料定稿后再签署');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'SIGNED', agreementSignedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- onboarding.service`
Expected: PASS（8 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/master/onboarding.service.ts src/master/onboarding.service.spec.ts
git commit -m "feat(backend): OnboardingService state machine (invite/info/sign)

Refs #6"
```

---

### Task 5: Onboarding DTO + controller + 接入 MasterModule + E2E

**Files:**
- Create: `backend/src/master/dto/redeem-invite.dto.ts`
- Create: `backend/src/master/dto/submit-info.dto.ts`
- Create: `backend/src/master/onboarding.controller.ts`
- Modify: `backend/src/master/master.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/e2e/onboarding.e2e-spec.ts`

- [ ] **Step 1: 写 DTO**

`backend/src/master/dto/redeem-invite.dto.ts`:

```typescript
import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RedeemInviteDto {
  @ApiProperty({ description: '8 位邀请码' })
  @IsString()
  @Length(8, 8)
  code!: string;
}
```

`backend/src/master/dto/submit-info.dto.ts`:

```typescript
import {
  IsArray,
  IsString,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitInfoDto {
  @ApiProperty({ description: '从业经历 / 师承' })
  @IsString()
  @MaxLength(2000)
  experience!: string;

  @ApiProperty({ description: '擅长方式（多选）', example: ['八字', '六爻'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  methods!: string[];

  @ApiProperty({ description: '擅长事项（多选）', example: ['事业咨询'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  topics!: string[];
}
```

- [ ] **Step 2: 写 onboarding.controller**

`backend/src/master/onboarding.controller.ts`:

```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingService } from './onboarding.service';
import { RedeemInviteDto } from './dto/redeem-invite.dto';
import { SubmitInfoDto } from './dto/submit-info.dto';

@ApiTags('master-onboarding')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('redeem-invite')
  @ApiOperation({ summary: '师傅兑换邀请码' })
  redeem(@CurrentUser() user: AuthenticatedUser, @Body() dto: RedeemInviteDto) {
    return this.onboarding.redeemInvite(user.id, dto.code);
  }

  @Post('submit-info')
  @ApiOperation({ summary: '师傅提交基础信息' })
  submitInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitInfoDto,
  ) {
    return this.onboarding.submitInfo(user.id, dto);
  }

  @Post('sign')
  @ApiOperation({ summary: '师傅签署平台公约' })
  sign(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.signAgreement(user.id);
  }
}
```

- [ ] **Step 3: 接入 MasterModule**

修改 `backend/src/master/master.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  controllers: [OnboardingController],
  providers: [MasterService, OnboardingService],
  exports: [MasterService],
})
export class MasterModule {}
```

- [ ] **Step 4: 在 AppModule 注册 MasterModule**

修改 `backend/src/app.module.ts`，import `MasterModule` 并加入 `imports`（放在 `AuthModule` 之后、`AdminModule` 之前即可）：

```typescript
import { MasterModule } from './master/master.module';
// ...
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    MasterModule,
    AdminModule,
  ],
```

> 注：`AuthModule` 已 `import MasterModule`，但那是为了拿 `MasterService`（provider）。AppModule 直接 import MasterModule 才能挂载它的 controllers。Nest 模块可被多处 import，无副作用。

- [ ] **Step 5: 写 E2E（入驻全流程）**

`backend/test/e2e/onboarding.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let masterId: string;
  let codeId: string;

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
        phone: '13900139201',
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
    const code = await prisma.inviteCode.create({
      data: { code: 'ONBOARD1' },
    });
    codeId = code.id;
  });

  afterAll(async () => {
    await prisma.inviteCode.deleteMany({ where: { id: codeId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  const token = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('redeem -> submit-info -> (admin drafts) -> sign progresses the funnel', async () => {
    const redeemed = await request(app.getHttpServer())
      .post('/masters/me/onboarding/redeem-invite')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: 'ONBOARD1' })
      .expect(201);
    expect(redeemed.body.data.onboardingStep).toBe('INVITED');

    const info = await request(app.getHttpServer())
      .post('/masters/me/onboarding/submit-info')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        experience: '从业十年',
        methods: ['八字', '六爻'],
        topics: ['事业咨询', '财运分析'],
      })
      .expect(201);
    expect(info.body.data.onboardingStep).toBe('INFO_SUBMITTED');

    // 模拟创始人后台润色后置为 PROFILE_DRAFTED（Task 8 提供真实端点）
    await prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'PROFILE_DRAFTED' },
    });

    const signed = await request(app.getHttpServer())
      .post('/masters/me/onboarding/sign')
      .set('Authorization', `Bearer ${token()}`)
      .expect(201);
    expect(signed.body.data.onboardingStep).toBe('SIGNED');
    expect(signed.body.data.agreementSignedAt).toBeTruthy();
  });

  it('rejects redeeming an already-used code', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/onboarding/redeem-invite')
      .set('Authorization', `Bearer ${token()}`)
      .send({ code: 'ONBOARD1' })
      .expect(400);
  });

  it('rejects sign without MASTER token (401)', async () => {
    await request(app.getHttpServer())
      .post('/masters/me/onboarding/sign')
      .expect(401);
  });
});
```

- [ ] **Step 6: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json onboarding`
Expected: PASS（3 tests）。

- [ ] **Step 7: Commit**

```bash
git add src/master/dto/redeem-invite.dto.ts src/master/dto/submit-info.dto.ts src/master/onboarding.controller.ts src/master/master.module.ts src/app.module.ts test/e2e/onboarding.e2e-spec.ts
git commit -m "feat(backend): master onboarding endpoints + e2e

Refs #6"
```

---

### Task 6: ProfileService — 师傅 Profile 读/写 + 公开读

**Files:**
- Create: `backend/src/master/profile.service.ts`
- Test: `backend/src/master/profile.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/master/profile.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: { master: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { master: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [ProfileService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ProfileService);
  });

  describe('getMyProfile', () => {
    it('returns the master record', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1' });
      expect(await service.getMyProfile('m1')).toEqual({ id: 'm1' });
    });
    it('throws NotFound when missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.getMyProfile('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates allowed presentation fields only', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'PENDING' });
      prisma.master.update.mockResolvedValue({ id: 'm1', displayName: '玄一' });
      const result = await service.updateProfile('m1', {
        displayName: '玄一',
        intro: '专注八字十年',
      });
      expect(result.displayName).toBe('玄一');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { displayName: '玄一', intro: '专注八字十年' },
      });
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(
        service.updateProfile('x', { displayName: 'a' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicProfile', () => {
    it('returns ACTIVE master', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });
      expect(await service.getPublicProfile('m1')).toMatchObject({ id: 'm1' });
    });
    it('throws NotFound for non-ACTIVE master', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', status: 'PENDING' });
      await expect(service.getPublicProfile('m1')).rejects.toThrow(
        NotFoundException,
      );
    });
    it('throws NotFound when missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.getPublicProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- profile.service`
Expected: FAIL（`Cannot find module './profile.service'`）。

- [ ] **Step 3: 实现 ProfileService**

`backend/src/master/profile.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateProfileInput {
  displayName?: string;
  avatar?: string;
  intro?: string;
  philosophy?: string;
  videoUrl?: string;
  methods?: string[];
  topics?: string[];
  experience?: string;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyProfile(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async updateProfile(
    masterId: string,
    input: UpdateProfileInput,
  ): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return this.prisma.master.update({
      where: { id: masterId },
      data: { ...input },
    });
  }

  async getPublicProfile(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master || master.status !== 'ACTIVE') {
      throw new NotFoundException('师傅不存在或未上架');
    }
    return master;
  }
}
```

> 注：`ValidationPipe` 的 `whitelist:true` 会剥离 DTO 未声明字段，故 `input` 已是受控字段集合，`data: { ...input }` 安全（`undefined` 字段 Prisma 自动忽略）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- profile.service`
Expected: PASS（8 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/master/profile.service.ts src/master/profile.service.spec.ts
git commit -m "feat(backend): ProfileService (self read/update + public read)

Refs #5"
```

---

### Task 7: Profile DTO + master.controller + 接入 MasterModule + E2E

**Files:**
- Create: `backend/src/master/dto/update-profile.dto.ts`
- Create: `backend/src/master/master.controller.ts`
- Modify: `backend/src/master/master.module.ts`
- Test: `backend/test/e2e/master-profile.e2e-spec.ts`

- [ ] **Step 1: 写 DTO**

`backend/src/master/dto/update-profile.dto.ts`:

```typescript
import {
  IsArray,
  IsOptional,
  IsString,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '师傅名号' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatar?: string;

  @ApiPropertyOptional({ description: '简介（≤50 字）' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  intro?: string;

  @ApiPropertyOptional({ description: '解读理念' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  philosophy?: string;

  @ApiPropertyOptional({ description: '自述视频 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({ description: '从业经历 / 师承' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  experience?: string;

  @ApiPropertyOptional({ description: '擅长方式', example: ['八字'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  methods?: string[];

  @ApiPropertyOptional({ description: '擅长事项', example: ['感情咨询'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  topics?: string[];
}
```

- [ ] **Step 2: 写 master.controller**

`backend/src/master/master.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('master-profile')
@Controller('masters')
export class MasterController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅获取本人 profile' })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.profile.getMyProfile(user.id);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅编辑本人 profile' })
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profile.updateProfile(user.id, dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '公开获取已上架师傅 profile' })
  getPublic(@Param('id') id: string) {
    return this.profile.getPublicProfile(id);
  }
}
```

> 注：`@Public()` 装饰器已存在于 `common/decorators/public.decorator.ts`。`GET /masters/:id` 不挂 JWT 守卫，任何人可读，但 service 层只放行 ACTIVE 师傅。`GET /masters/me` 在路由匹配上优先于 `:id`（Nest 按声明顺序匹配，`me` 在 `:id` 之前声明）。

- [ ] **Step 3: 接入 MasterModule**

修改 `backend/src/master/master.module.ts`，加入 `MasterController` 与 `ProfileService`：

```typescript
import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';

@Module({
  controllers: [OnboardingController, MasterController],
  providers: [MasterService, OnboardingService, ProfileService],
  exports: [MasterService],
})
export class MasterModule {}
```

- [ ] **Step 4: 写 E2E**

`backend/test/e2e/master-profile.e2e-spec.ts`:

```typescript
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
      .send({ displayName: '玄一道长', intro: '专注八字解读十年', methods: ['八字'] })
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
  });

  it('GET /masters/me requires MASTER token', async () => {
    await request(app.getHttpServer()).get('/masters/me').expect(401);
  });
});
```

- [ ] **Step 5: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json master-profile`
Expected: PASS（4 tests）。

- [ ] **Step 6: Commit**

```bash
git add src/master/dto/update-profile.dto.ts src/master/master.controller.ts src/master/master.module.ts test/e2e/master-profile.e2e-spec.ts
git commit -m "feat(backend): master profile self-service + public read endpoints + e2e

Refs #5"
```

---

### Task 8: AdminMasterService — 润色 profile / 授予徽章 / 上架

**Files:**
- Create: `backend/src/admin/admin-master.service.ts`
- Test: `backend/src/admin/admin-master.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/admin/admin-master.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { AdminMasterService } from './admin-master.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminMasterService', () => {
  let service: AdminMasterService;
  let prisma: { master: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = { master: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminMasterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminMasterService);
  });

  describe('polishProfile', () => {
    it('updates fields and sets step PROFILE_DRAFTED from INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INFO_SUBMITTED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      const result = await service.polishProfile('m1', { intro: '润色版简介' });
      expect(result.onboardingStep).toBe('PROFILE_DRAFTED');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { intro: '润色版简介', onboardingStep: 'PROFILE_DRAFTED' },
      });
    });

    it('rejects polish when step is before INFO_SUBMITTED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'INVITED',
      });
      await expect(
        service.polishProfile('m1', { intro: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.polishProfile('x', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('grantBadge', () => {
    it('appends a badge without duplicates', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        badges: ['严选', '专家'],
      });
      const result = await service.grantBadge('m1', '专家');
      expect(result.badges).toEqual(['严选', '专家']);
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { badges: ['严选', '专家'] },
      });
    });

    it('is idempotent when badge already present', async () => {
      prisma.master.findUnique.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      prisma.master.update.mockResolvedValue({ id: 'm1', badges: ['严选'] });
      const result = await service.grantBadge('m1', '严选');
      expect(result.badges).toEqual(['严选']);
    });

    it('throws NotFound when master missing', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      await expect(service.grantBadge('x', '严选')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('activate', () => {
    it('sets LIVE + ACTIVE from SIGNED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'SIGNED',
      });
      prisma.master.update.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'LIVE',
        status: 'ACTIVE',
      });
      const result = await service.activate('m1');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { onboardingStep: 'LIVE', status: 'ACTIVE' },
      });
    });

    it('rejects activate when not SIGNED', async () => {
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1',
        onboardingStep: 'PROFILE_DRAFTED',
      });
      await expect(service.activate('m1')).rejects.toThrow(ConflictException);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- admin-master.service`
Expected: FAIL（`Cannot find module './admin-master.service'`）。

- [ ] **Step 3: 实现 AdminMasterService**

`backend/src/admin/admin-master.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Master } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PolishProfileInput {
  displayName?: string;
  avatar?: string;
  intro?: string;
  philosophy?: string;
  videoUrl?: string;
  experience?: string;
  methods?: string[];
  topics?: string[];
}

@Injectable()
export class AdminMasterService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMasterOrThrow(masterId: string): Promise<Master> {
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
    });
    if (!master) throw new NotFoundException('师傅不存在');
    return master;
  }

  async polishProfile(
    masterId: string,
    input: PolishProfileInput,
  ): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    const allowed = ['INFO_SUBMITTED', 'PROFILE_DRAFTED'];
    if (!allowed.includes(master.onboardingStep)) {
      throw new ConflictException('师傅尚未提交基础信息，无法润色');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { ...input, onboardingStep: 'PROFILE_DRAFTED' },
    });
  }

  async grantBadge(masterId: string, badge: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    const current = Array.isArray(master.badges)
      ? (master.badges as string[])
      : [];
    const badges = current.includes(badge) ? current : [...current, badge];
    return this.prisma.master.update({
      where: { id: masterId },
      data: { badges },
    });
  }

  async activate(masterId: string): Promise<Master> {
    const master = await this.getMasterOrThrow(masterId);
    if (master.onboardingStep !== 'SIGNED') {
      throw new ConflictException('师傅未完成签约，无法上架');
    }
    return this.prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'LIVE', status: 'ACTIVE' },
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- admin-master.service`
Expected: PASS（8 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin-master.service.ts src/admin/admin-master.service.spec.ts
git commit -m "feat(backend): AdminMasterService (polish/badge/activate)

Refs #5 #6"
```

---

### Task 9: Admin master-review DTO + 端点 + E2E

**Files:**
- Create: `backend/src/admin/dto/polish-profile.dto.ts`
- Create: `backend/src/admin/dto/grant-badge.dto.ts`
- Modify: `backend/src/admin/admin.controller.ts`
- Modify: `backend/src/admin/admin.module.ts`
- Modify: `backend/test/e2e/admin-master.e2e-spec.ts`（追加 master 审核用例）

- [ ] **Step 1: 写 DTO**

`backend/src/admin/dto/polish-profile.dto.ts`:

```typescript
import {
  IsArray,
  IsOptional,
  IsString,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PolishProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  avatar?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  intro?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  philosophy?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  experience?: string;

  @ApiPropertyOptional({ example: ['八字'] })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @IsString({ each: true }) @MaxLength(20, { each: true })
  methods?: string[];

  @ApiPropertyOptional({ example: ['感情咨询'] })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @IsString({ each: true }) @MaxLength(20, { each: true })
  topics?: string[];
}
```

`backend/src/admin/dto/grant-badge.dto.ts`:

```typescript
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantBadgeDto {
  @ApiProperty({ description: '徽章名，如「严选」' })
  @IsString()
  @MaxLength(20)
  badge!: string;
}
```

- [ ] **Step 2: 扩展 admin.controller**

修改 `backend/src/admin/admin.controller.ts`：构造函数注入 `AdminMasterService`，并新增三个端点。完整文件：

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InviteService } from './invite.service';
import { AdminMasterService } from './admin-master.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { PolishProfileDto } from './dto/polish-profile.dto';
import { GrantBadgeDto } from './dto/grant-badge.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly invites: InviteService,
    private readonly masters: AdminMasterService,
  ) {}

  @Post('invites')
  @ApiOperation({ summary: '生成邀请码' })
  createInvite(@Body() dto: CreateInviteDto) {
    return this.invites.generate(dto.note);
  }

  @Get('invites')
  @ApiOperation({ summary: '列出全部邀请码' })
  listInvites() {
    return this.invites.list();
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: '作废一个未使用的邀请码' })
  revokeInvite(@Param('id') id: string) {
    return this.invites.revoke(id);
  }

  @Patch('masters/:id/profile')
  @ApiOperation({ summary: '创始人润色师傅 profile（→ PROFILE_DRAFTED）' })
  polishProfile(@Param('id') id: string, @Body() dto: PolishProfileDto) {
    return this.masters.polishProfile(id, dto);
  }

  @Post('masters/:id/badges')
  @ApiOperation({ summary: '授予师傅徽章' })
  grantBadge(@Param('id') id: string, @Body() dto: GrantBadgeDto) {
    return this.masters.grantBadge(id, dto.badge);
  }

  @Post('masters/:id/activate')
  @ApiOperation({ summary: '终审上架师傅（SIGNED → LIVE/ACTIVE）' })
  activate(@Param('id') id: string) {
    return this.masters.activate(id);
  }
}
```

- [ ] **Step 3: 在 admin.module 注册 AdminMasterService**

修改 `backend/src/admin/admin.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { InviteService } from './invite.service';
import { AdminMasterService } from './admin-master.service';

@Module({
  controllers: [AdminController],
  providers: [InviteService, AdminMasterService],
})
export class AdminModule {}
```

- [ ] **Step 4: 追加 E2E 用例（在 admin-master.e2e-spec.ts 末尾，`describe` 内新增一个嵌套块）**

在 `backend/test/e2e/admin-master.e2e-spec.ts` 的最外层 `describe('Admin invite codes (e2e)', ...)` **之后**，新增第二个 `describe`（同一文件，复用 import）。把以下内容追加到文件末尾：

```typescript
describe('Admin master review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let masterId: string;

  const adminToken = () => jwt.sign({ sub: 'admin_e2e2', role: 'ADMIN' });

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
        phone: '13900139401',
        onboardingStep: 'INFO_SUBMITTED',
        displayName: '',
        avatar: '',
        intro: '',
        experience: '初稿',
        philosophy: '',
        methods: ['八字'],
        topics: ['事业咨询'],
      },
    });
    masterId = master.id;
  });

  afterAll(async () => {
    await prisma.master.deleteMany({ where: { id: masterId } });
    await app.close();
  });

  it('polish -> sign(simulated) -> grant badge -> activate', async () => {
    const polished = await request(app.getHttpServer())
      .patch(`/admin/masters/${masterId}/profile`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ intro: '资深八字咨询师', philosophy: '以人为本' })
      .expect(200);
    expect(polished.body.data.onboardingStep).toBe('PROFILE_DRAFTED');

    // 模拟师傅签约
    await prisma.master.update({
      where: { id: masterId },
      data: { onboardingStep: 'SIGNED' },
    });

    const badged = await request(app.getHttpServer())
      .post(`/admin/masters/${masterId}/badges`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ badge: '严选' })
      .expect(201);
    expect(badged.body.data.badges).toContain('严选');

    const activated = await request(app.getHttpServer())
      .post(`/admin/masters/${masterId}/activate`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(201);
    expect(activated.body.data.status).toBe('ACTIVE');
    expect(activated.body.data.onboardingStep).toBe('LIVE');
  });

  it('rejects activate before SIGNED with 409', async () => {
    const m = await prisma.master.create({
      data: {
        phone: '13900139402',
        onboardingStep: 'PROFILE_DRAFTED',
        displayName: '', avatar: '', intro: '',
        experience: '', philosophy: '', methods: [], topics: [],
      },
    });
    await request(app.getHttpServer())
      .post(`/admin/masters/${m.id}/activate`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(409);
    await prisma.master.deleteMany({ where: { id: m.id } });
  });
});
```

- [ ] **Step 5: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json admin-master`
Expected: PASS（原 3 + 新 2 = 5 tests）。

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/polish-profile.dto.ts src/admin/dto/grant-badge.dto.ts src/admin/admin.controller.ts src/admin/admin.module.ts test/e2e/admin-master.e2e-spec.ts
git commit -m "feat(backend): admin master review endpoints (polish/badge/activate) + e2e

Refs #5 #6"
```

---

### Task 10: SkuService — SKU CRUD（跨字段校验）

**Files:**
- Create: `backend/src/master/sku.service.ts`
- Test: `backend/src/master/sku.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/master/sku.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkuService } from './sku.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SkuService', () => {
  let service: SkuService;
  let prisma: {
    serviceSKU: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      serviceSKU: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [SkuService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SkuService);
  });

  describe('create', () => {
    it('creates an ASYNC_REPORT sku with deliveryHour', async () => {
      prisma.serviceSKU.create.mockImplementation(async ({ data }) => ({
        id: 's1',
        ...data,
      }));
      const sku = await service.create('m1', {
        name: '八字解读报告',
        type: 'ASYNC_REPORT',
        price: 9900,
        deliveryHour: 48,
        description: '详细书面报告',
      });
      expect(sku.id).toBe('s1');
      expect(prisma.serviceSKU.create).toHaveBeenCalledWith({
        data: {
          masterId: 'm1',
          name: '八字解读报告',
          type: 'ASYNC_REPORT',
          price: 9900,
          deliveryHour: 48,
          durationMin: null,
          description: '详细书面报告',
        },
      });
    });

    it('creates a REALTIME_IM sku with durationMin', async () => {
      prisma.serviceSKU.create.mockImplementation(async ({ data }) => ({
        id: 's2',
        ...data,
      }));
      const sku = await service.create('m1', {
        name: '30分钟塔罗答疑',
        type: 'REALTIME_IM',
        price: 19900,
        durationMin: 30,
        description: '实时 IM',
      });
      expect(sku.id).toBe('s2');
    });

    it('rejects ASYNC_REPORT without deliveryHour', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'ASYNC_REPORT',
          price: 9900,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects REALTIME_IM without durationMin', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'REALTIME_IM',
          price: 9900,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-positive price', async () => {
      await expect(
        service.create('m1', {
          name: 'x',
          type: 'ASYNC_REPORT',
          price: 0,
          deliveryHour: 24,
          description: 'y',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns the master own skus', async () => {
      prisma.serviceSKU.findMany.mockResolvedValue([{ id: 's1' }]);
      const result = await service.list('m1');
      expect(result).toEqual([{ id: 's1' }]);
      expect(prisma.serviceSKU.findMany).toHaveBeenCalledWith({
        where: { masterId: 'm1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('updates a sku owned by the master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({ id: 's1', masterId: 'm1' });
      prisma.serviceSKU.update.mockResolvedValue({ id: 's1', price: 12900 });
      const result = await service.update('m1', 's1', { price: 12900 });
      expect(result.price).toBe(12900);
    });

    it('throws NotFound when sku not owned by master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({ id: 's1', masterId: 'other' });
      await expect(
        service.update('m1', 's1', { price: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when sku missing', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue(null);
      await expect(
        service.update('m1', 'nope', { price: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects non-positive price on update', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({ id: 's1', masterId: 'm1' });
      await expect(
        service.update('m1', 's1', { price: -5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable', () => {
    it('sets status DISABLED for owned sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({ id: 's1', masterId: 'm1' });
      prisma.serviceSKU.update.mockResolvedValue({ id: 's1', status: 'DISABLED' });
      const result = await service.disable('m1', 's1');
      expect(result.status).toBe('DISABLED');
      expect(prisma.serviceSKU.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'DISABLED' },
      });
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- sku.service`
Expected: FAIL（`Cannot find module './sku.service'`）。

- [ ] **Step 3: 实现 SkuService**

`backend/src/master/sku.service.ts`:

```typescript
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceSKU, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSkuInput {
  name: string;
  type: ServiceType;
  price: number;
  durationMin?: number;
  deliveryHour?: number;
  description: string;
}

export interface UpdateSkuInput {
  name?: string;
  price?: number;
  durationMin?: number;
  deliveryHour?: number;
  description?: string;
}

@Injectable()
export class SkuService {
  constructor(private readonly prisma: PrismaService) {}

  async create(masterId: string, input: CreateSkuInput): Promise<ServiceSKU> {
    if (input.price < 1) {
      throw new BadRequestException('价格必须为正整数（单位：分）');
    }
    if (input.type === 'ASYNC_REPORT' && !input.deliveryHour) {
      throw new BadRequestException('异步报告必须设置承诺交付时长 deliveryHour');
    }
    if (input.type === 'REALTIME_IM' && !input.durationMin) {
      throw new BadRequestException('实时 IM 必须设置单次时长 durationMin');
    }
    return this.prisma.serviceSKU.create({
      data: {
        masterId,
        name: input.name,
        type: input.type,
        price: input.price,
        deliveryHour: input.deliveryHour ?? null,
        durationMin: input.durationMin ?? null,
        description: input.description,
      },
    });
  }

  async list(masterId: string): Promise<ServiceSKU[]> {
    return this.prisma.serviceSKU.findMany({
      where: { masterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getOwnedOrThrow(
    masterId: string,
    skuId: string,
  ): Promise<ServiceSKU> {
    const sku = await this.prisma.serviceSKU.findUnique({ where: { id: skuId } });
    if (!sku || sku.masterId !== masterId) {
      throw new NotFoundException('SKU 不存在');
    }
    return sku;
  }

  async update(
    masterId: string,
    skuId: string,
    input: UpdateSkuInput,
  ): Promise<ServiceSKU> {
    await this.getOwnedOrThrow(masterId, skuId);
    if (input.price !== undefined && input.price < 1) {
      throw new BadRequestException('价格必须为正整数（单位：分）');
    }
    return this.prisma.serviceSKU.update({
      where: { id: skuId },
      data: { ...input },
    });
  }

  async disable(masterId: string, skuId: string): Promise<ServiceSKU> {
    await this.getOwnedOrThrow(masterId, skuId);
    return this.prisma.serviceSKU.update({
      where: { id: skuId },
      data: { status: 'DISABLED' },
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- sku.service`
Expected: PASS（12 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/master/sku.service.ts src/master/sku.service.spec.ts
git commit -m "feat(backend): SkuService CRUD with cross-field validation

Refs #5"
```

---

### Task 11: SKU DTO + sku.controller + 接入 MasterModule + E2E

**Files:**
- Create: `backend/src/master/dto/create-sku.dto.ts`
- Create: `backend/src/master/dto/update-sku.dto.ts`
- Create: `backend/src/master/sku.controller.ts`
- Modify: `backend/src/master/master.module.ts`
- Test: `backend/test/e2e/master-sku.e2e-spec.ts`

- [ ] **Step 1: 写 DTO**

`backend/src/master/dto/create-sku.dto.ts`:

```typescript
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class CreateSkuDto {
  @ApiProperty({ description: 'SKU 名称' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: ServiceType, description: '异步报告 / 实时 IM' })
  @IsEnum(ServiceType)
  type!: ServiceType;

  @ApiProperty({ description: '价格（单位：分）' })
  @IsInt()
  @Min(1)
  price!: number;

  @ApiPropertyOptional({ description: '实时 IM 单次时长（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;

  @ApiPropertyOptional({ description: '异步报告承诺交付时长（小时）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryHour?: number;

  @ApiProperty({ description: '包含内容描述' })
  @IsString()
  @MaxLength(2000)
  description!: string;
}
```

`backend/src/master/dto/update-sku.dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSkuDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: '价格（分）' })
  @IsOptional() @IsInt() @Min(1)
  price?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  durationMin?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  deliveryHour?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}
```

- [ ] **Step 2: 写 sku.controller**

`backend/src/master/sku.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SkuService } from './sku.service';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';

@ApiTags('master-sku')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/skus')
export class SkuController {
  constructor(private readonly skus: SkuService) {}

  @Post()
  @ApiOperation({ summary: '创建 SKU' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSkuDto) {
    return this.skus.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出本人 SKU' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.skus.list(user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 SKU' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.skus.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '下架 SKU（置为 DISABLED）' })
  disable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.skus.disable(user.id, id);
  }
}
```

- [ ] **Step 3: 接入 MasterModule**

修改 `backend/src/master/master.module.ts`，加入 `SkuController` 与 `SkuService`：

```typescript
import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';
import { SkuService } from './sku.service';
import { SkuController } from './sku.controller';

@Module({
  controllers: [OnboardingController, MasterController, SkuController],
  providers: [MasterService, OnboardingService, ProfileService, SkuService],
  exports: [MasterService],
})
export class MasterModule {}
```

- [ ] **Step 4: 写 E2E**

`backend/test/e2e/master-sku.e2e-spec.ts`:

```typescript
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
        displayName: '', avatar: '', intro: '',
        experience: '', philosophy: '', methods: [], topics: [],
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
});
```

- [ ] **Step 5: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json master-sku`
Expected: PASS（4 tests）。

- [ ] **Step 6: Commit**

```bash
git add src/master/dto/create-sku.dto.ts src/master/dto/update-sku.dto.ts src/master/sku.controller.ts src/master/master.module.ts test/e2e/master-sku.e2e-spec.ts
git commit -m "feat(backend): master SKU endpoints + e2e

Refs #5"
```

---

### Task 12: ScheduleService — 排期 CRUD

**Files:**
- Create: `backend/src/master/schedule.service.ts`
- Test: `backend/src/master/schedule.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`backend/src/master/schedule.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let prisma: {
    schedule: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      schedule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ScheduleService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ScheduleService);
  });

  describe('create', () => {
    it('creates a valid schedule slot', async () => {
      prisma.schedule.create.mockImplementation(async ({ data }) => ({
        id: 'sc1',
        ...data,
      }));
      const result = await service.create('m1', {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '12:00',
      });
      expect(result.id).toBe('sc1');
      expect(prisma.schedule.create).toHaveBeenCalledWith({
        data: { masterId: 'm1', dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
      });
    });

    it('rejects when startTime >= endTime', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects bad time format', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 1, startTime: '9am', endTime: '12:00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dayOfWeek out of range', async () => {
      await expect(
        service.create('m1', { dayOfWeek: 7, startTime: '09:00', endTime: '12:00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns master schedules ordered by day then start', async () => {
      prisma.schedule.findMany.mockResolvedValue([{ id: 'sc1' }]);
      const result = await service.list('m1');
      expect(result).toEqual([{ id: 'sc1' }]);
      expect(prisma.schedule.findMany).toHaveBeenCalledWith({
        where: { masterId: 'm1' },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  });

  describe('remove', () => {
    it('deletes a slot owned by the master', async () => {
      prisma.schedule.findUnique.mockResolvedValue({ id: 'sc1', masterId: 'm1' });
      prisma.schedule.delete.mockResolvedValue({ id: 'sc1' });
      const result = await service.remove('m1', 'sc1');
      expect(result).toEqual({ id: 'sc1' });
      expect(prisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 'sc1' } });
    });

    it('throws NotFound when slot not owned', async () => {
      prisma.schedule.findUnique.mockResolvedValue({ id: 'sc1', masterId: 'other' });
      await expect(service.remove('m1', 'sc1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when slot missing', async () => {
      prisma.schedule.findUnique.mockResolvedValue(null);
      await expect(service.remove('m1', 'x')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- schedule.service`
Expected: FAIL（`Cannot find module './schedule.service'`）。

- [ ] **Step 3: 实现 ScheduleService**

`backend/src/master/schedule.service.ts`:

```typescript
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Schedule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateScheduleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    masterId: string,
    input: CreateScheduleInput,
  ): Promise<Schedule> {
    if (input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new BadRequestException('dayOfWeek 必须在 0-6 之间');
    }
    if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
      throw new BadRequestException('时间格式必须为 HH:mm');
    }
    if (input.startTime >= input.endTime) {
      throw new BadRequestException('开始时间必须早于结束时间');
    }
    return this.prisma.schedule.create({
      data: {
        masterId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });
  }

  async list(masterId: string): Promise<Schedule[]> {
    return this.prisma.schedule.findMany({
      where: { masterId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async remove(masterId: string, scheduleId: string): Promise<Schedule> {
    const slot = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
    });
    if (!slot || slot.masterId !== masterId) {
      throw new NotFoundException('排期不存在');
    }
    return this.prisma.schedule.delete({ where: { id: scheduleId } });
  }
}
```

> 注：`startTime >= endTime` 用字符串比较有效，因为 `HH:mm` 零填充后字典序等价于时间序。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- schedule.service`
Expected: PASS（8 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/master/schedule.service.ts src/master/schedule.service.spec.ts
git commit -m "feat(backend): ScheduleService CRUD with validation

Refs #5"
```

---

### Task 13: Schedule DTO + schedule.controller + 接入 MasterModule + E2E

**Files:**
- Create: `backend/src/master/dto/create-schedule.dto.ts`
- Create: `backend/src/master/dto/update-schedule.dto.ts`（保留以备扩展；本任务仅 create/list/delete，故 update DTO 可省略——见注）
- Create: `backend/src/master/schedule.controller.ts`
- Modify: `backend/src/master/master.module.ts`
- Test: `backend/test/e2e/master-schedule.e2e-spec.ts`

> **YAGNI 注**：排期没有「编辑」需求（删除 + 新建即可覆盖），故**不创建** `update-schedule.dto.ts`，controller 只暴露 POST/GET/DELETE。File Structure 中列出的 update-schedule.dto.ts 不实现。

- [ ] **Step 1: 写 DTO**

`backend/src/master/dto/create-schedule.dto.ts`:

```typescript
import { IsInt, IsString, Min, Max, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScheduleDto {
  @ApiProperty({ description: '星期几（0=周日 ... 6=周六）' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ description: '开始时间 HH:mm', example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  startTime!: string;

  @ApiProperty({ description: '结束时间 HH:mm', example: '12:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  endTime!: string;
}
```

- [ ] **Step 2: 写 schedule.controller**

`backend/src/master/schedule.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';

@ApiTags('master-schedule')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/schedules')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Post()
  @ApiOperation({ summary: '新增可预约时段' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedules.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出本人排期' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.schedules.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除一个时段' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.schedules.remove(user.id, id);
  }
}
```

- [ ] **Step 3: 接入 MasterModule（最终形态）**

修改 `backend/src/master/master.module.ts` 为最终完整版：

```typescript
import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';
import { SkuService } from './sku.service';
import { SkuController } from './sku.controller';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';

@Module({
  controllers: [
    OnboardingController,
    MasterController,
    SkuController,
    ScheduleController,
  ],
  providers: [
    MasterService,
    OnboardingService,
    ProfileService,
    SkuService,
    ScheduleService,
  ],
  exports: [MasterService],
})
export class MasterModule {}
```

- [ ] **Step 4: 写 E2E**

`backend/test/e2e/master-schedule.e2e-spec.ts`:

```typescript
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
```

- [ ] **Step 5: 跑 E2E 确认通过**

Run: `pnpm exec jest --config ./test/jest-e2e.json master-schedule`
Expected: PASS（4 tests）。

- [ ] **Step 6: Commit**

```bash
git add src/master/dto/create-schedule.dto.ts src/master/schedule.controller.ts src/master/master.module.ts test/e2e/master-schedule.e2e-spec.ts
git commit -m "feat(backend): master schedule endpoints + e2e

Refs #5"
```

---

### Task 14: 全量回归 + lint + build + 最终评审

**Files:** 无新增（验证 + 可能的微调）

- [ ] **Step 1: 全量单元测试**

Run:
```bash
export PATH="$HOME/Library/pnpm/bin:$PATH" && cd backend && pnpm test 2>&1 | tail -8
```
Expected: 全部 PASS（原 20 + 新增 InviteService 5 + Onboarding 8 + Profile 8 + AdminMaster 8 + Sku 12 + Schedule 8 = 69，数字以实际为准），`Test Suites: N passed`。

- [ ] **Step 2: 全量 E2E**

Run:
```bash
pnpm test:e2e 2>&1 | tail -10
```
Expected: 全部 PASS（原 3 套 9 个 + 新增 onboarding/master-profile/master-sku/master-schedule/admin-master 五套），无 fail。

- [ ] **Step 3: Lint**

Run: `pnpm lint 2>&1 | tail -5`
Expected: 无 error（`eslint --fix` 自动修复格式后退出 0）。若有改动产生，纳入下方 commit。

- [ ] **Step 4: Build**

Run: `pnpm build 2>&1 | tail -5`
Expected: `nest build` 成功，无 TS 错误。

- [ ] **Step 5: 若 lint/build 触发任何文件改动则提交**

```bash
git add -A
git commit -m "chore(backend): lint/format fixups for master supply" || echo "nothing to commit"
```

- [ ] **Step 6: 最终自检清单（人工核对，不写代码）**

逐项确认：
- 入驻状态机六态闭环可走通（onboarding.e2e + admin-master.e2e 联合覆盖 REGISTERED→…→LIVE）。
- 所有师傅自助端点 `@Roles('MASTER')`；所有 admin 端点 `@Roles('ADMIN')`；公开读 `@Public()`。
- 金额单位统一为分；SKU 跨字段校验（异步↔deliveryHour、实时↔durationMin）双层（DTO + service）。
- 所有 service 对「不存在 / 越权」返回 404，对状态冲突返回 409，对入参非法返回 400。
- `master.service.ts`（findOrCreateByPhone/bindUnionid）与既有 auth E2E 未被破坏。

---

## Self-Review（写计划时已执行）

**1. Spec coverage**（对照 spec §5.1 师傅系统 + #5/#6）：
- 邀请制入驻 → Task 2/3（邀请码）+ Task 4/5（兑换/提交/签约）+ Task 8/9（润色/上架）✅
- 实名核身 / 视频访谈 / AI 抽取 → **按用户决策不实现**，Master 已有 `realname/realnameVerified/idNumberHash` 字段承载未来人脸核身结果；创始人线下访谈后用 `PATCH /admin/masters/:id/profile` 录入 ✅（已在计划开头声明范围排除）
- 师傅 Profile（名号/头像/简介/师承/理念/视频/方式/事项/徽章/量化）→ Task 6/7（自助）+ Task 8/9（徽章）✅。量化字段（评分/服务人次等）由订单/评价系统沉淀，属 Plan 3/4，本计划不造 ✅
- 服务 SKU（类型/价格/时长/交付承诺）→ Task 10/11 ✅
- 排期（周历式时段）→ Task 12/13 ✅
- 订单管理（接单/改价/延期/交付）→ **属 Plan 3 商业核心**，本计划不含（已在开头声明）✅
- 财务（结算/提现）→ Settlement 模型已存在，逻辑属 Plan 3 ✅

**2. Placeholder scan**：无 TBD/TODO；每个 service/controller/DTO/test 步骤均含完整代码。✅

**3. Type consistency**：
- `MasterOnboardingStep` 六值在 schema（Task1）、OnboardingService（Task4）、AdminMasterService（Task8）一致。
- `ServiceType`（ASYNC_REPORT/REALTIME_IM）来自 `@prisma/client`，SkuService/DTO/test 一致。
- 金额字段 `price: Int`（分）贯穿 SKU service/DTO/e2e。
- `@CurrentUser().id` = masterId 约定在所有师傅自助 controller 一致。
- 响应包络 `resp.body.data` 在所有 e2e 一致。

**已知取舍/缺口（非阻塞）**：
- ADMIN token 无登录流程，靠手动签发；真正的 admin 鉴权留待后续计划（YAGNI）。
- `master.service.ts` 的 `findOrCreateByPhone` 不设 `onboardingStep`，依赖 schema `@default(REGISTERED)`。
- 公开师傅列表/筛选（C 端 feed）属 Plan 4，本计划只提供单个公开 profile 读取。
