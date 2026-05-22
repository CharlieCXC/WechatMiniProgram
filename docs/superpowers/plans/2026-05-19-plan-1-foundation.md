# Plan 1: Foundation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the backend foundation (NestJS + Prisma + MySQL + Redis + 微信登录 + 师傅手机号登录 + JWT + RBAC) so that Plans 2-5 can build business modules on top of a working API, complete data schema, and rock-solid auth.

**Architecture:** NestJS modular monolith with Prisma ORM and MySQL. Two auth flows: (a) C 端 用户 via 微信 `code2Session` → JWT; (b) 师傅 via 手机号 + 短信验证码 → JWT. RBAC with three roles (USER / MASTER / ADMIN). External integrations (微信开放接口、腾讯云短信) wrapped as standalone modules with mock support for tests.

**Tech Stack:** Node.js 20 LTS · NestJS 10 · TypeScript 5 · Prisma 5 · MySQL 8 · Redis 7 · Jest · pnpm · Docker Compose (local dev) · GitHub Actions (CI)

**Repository Layout:** **Monorepo**. Backend lives at `backend/` subdirectory of this repo, alongside `pages/` (小程序) and `docs/`. Issue tracking, spec, and plan docs unified.

**Related Issues:** [Epic #1](https://github.com/CharlieCXC/regards/WechatMiniProgram/issues/1) / Feature [#3 后端基础](https://github.com/CharlieCXC/WechatMiniProgram/issues/3) / Feature [#4 鉴权系统](https://github.com/CharlieCXC/WechatMiniProgram/issues/4). Completing this plan closes both Feature Issues.

**Parallel Non-Code Work:** Feature [#2 业务前置](https://github.com/CharlieCXC/WechatMiniProgram/issues/2) (公司注册 / ICP 备案 / 商户号申请) runs in parallel — NOT covered by this plan. Required for production deploy, not for local development.

---

## File Structure (Locked Decomposition)

```
backend/
├── .env.example
├── .env                              # gitignored, copied from .env.example
├── .gitignore
├── docker-compose.dev.yml            # MySQL 8 + Redis 7 for local dev
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── README.md
├── prisma/
│   ├── schema.prisma                 # Full data model
│   └── migrations/
│       └── <timestamp>_init/
│           └── migration.sql
├── src/
│   ├── main.ts                       # NestJS bootstrap
│   ├── app.module.ts                 # Root module
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── config.service.ts         # Typed env access
│   │   └── env.validation.ts         # Joi-based env schema
│   ├── common/
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts
│   │   ├── interceptors/
│   │   │   └── response.interceptor.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   └── decorators/
│   │       ├── roles.decorator.ts
│   │       ├── current-user.decorator.ts
│   │       └── public.decorator.ts
│   ├── prisma/
│   │   ├── prisma.module.ts          # Global module
│   │   └── prisma.service.ts
│   ├── redis/
│   │   ├── redis.module.ts           # Global module
│   │   └── redis.service.ts
│   ├── wechat/
│   │   ├── wechat.module.ts
│   │   └── wechat.service.ts         # code2Session wrapper
│   ├── sms/
│   │   ├── sms.module.ts
│   │   └── sms.service.ts            # 腾讯云短信 wrapper
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts      # GET /health
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── dto/
│   │       ├── login-wechat.dto.ts
│   │       ├── login-master-phone.dto.ts
│   │       └── send-sms.dto.ts
│   ├── user/
│   │   ├── user.module.ts
│   │   └── user.service.ts           # findOrCreateByOpenid
│   └── master/
│       ├── master.module.ts
│       └── master.service.ts         # findOrCreateByPhone, bindUnionid
├── test/
│   ├── jest-e2e.json
│   └── e2e/
│       ├── health.e2e-spec.ts
│       ├── auth-wechat.e2e-spec.ts
│       └── auth-master.e2e-spec.ts
└── .github/workflows/
    └── backend-ci.yml                # OR live in repo root .github/workflows/
```

Each file has one clear responsibility. Modules are vertical slices (auth, user, master) rather than horizontal layers. External integrations (wechat, sms) are isolated for easy mocking.

---

## Task Sequence Overview

| Phase | Tasks | Output |
|---|---|---|
| A. Project Bootstrap | 1-5 | NestJS project compiles + lints + tests can run |
| B. Local Dev Infrastructure | 6-9 | MySQL + Redis running; env config validated |
| C. Prisma Schema & Migration | 10-15 | Full data model committed; initial migration runs |
| D. Common Infra Modules | 16-20 | PrismaService / RedisService / global filter / interceptor / health endpoint |
| E. External Service Wrappers | 21-24 | WechatService.code2Session + SmsService.send tested |
| F. User 微信登录 | 25-29 | POST /auth/login/wechat works E2E |
| G. 师傅 手机号登录 | 30-34 | POST /auth/sms/send + /auth/login/master + bind-unionid work E2E |
| H. RBAC & Guards | 35-37 | @Roles decorator + protected endpoints |
| I. CI/CD & Docs | 38-40 | GitHub Actions runs lint + test + build; backend README complete |

---

## Phase A — Project Bootstrap

### Task 1: Initialize NestJS project at `backend/`

**Files:**
- Create: `backend/` directory and entire NestJS scaffold via `nest new`

- [ ] **Step 1: Verify clean state**

Run: `git status` from repo root.
Expected: Output should NOT show `backend/` (will be created in next step).

- [ ] **Step 2: Run NestJS scaffold**

Run from repo root:
```bash
npx -y @nestjs/cli@10 new backend --skip-git --package-manager pnpm --strict
```
When prompted for package manager, confirm `pnpm`.

Expected output ends with: `🚀  Successfully created project backend`

- [ ] **Step 3: Verify scaffold structure**

Run: `ls backend/`
Expected: shows `src`, `test`, `package.json`, `tsconfig.json`, `nest-cli.json`, `.eslintrc.js`, `.prettierrc`.

- [ ] **Step 4: Verify it builds and tests run**

Run: `cd backend && pnpm test`
Expected: 1 test passes (`AppController › should return "Hello World!"`).

Run: `pnpm run build`
Expected: build succeeds, `dist/` created.

- [ ] **Step 5: Commit**

```bash
cd ..  # back to repo root
git add backend/
git commit -m "$(cat <<'EOF'
chore(backend): scaffold NestJS project via nest new

Refs #3
EOF
)"
```

---

### Task 2: Install core dependencies

**Files:**
- Modify: `backend/package.json` (via pnpm add)

- [ ] **Step 1: Install runtime dependencies**

Run from `backend/`:
```bash
pnpm add \
  @nestjs/config \
  @nestjs/jwt \
  @nestjs/passport \
  @nestjs/swagger \
  @nestjs/throttler \
  @prisma/client \
  bcryptjs \
  class-transformer \
  class-validator \
  ioredis \
  joi \
  passport \
  passport-jwt \
  swagger-ui-express \
  uuid
```

- [ ] **Step 2: Install dev dependencies**

```bash
pnpm add -D \
  prisma \
  @types/bcryptjs \
  @types/passport-jwt \
  @types/uuid \
  @types/supertest \
  ts-node
```

- [ ] **Step 3: Verify install**

Run: `pnpm list --depth=0`
Expected: All packages above appear in dependencies / devDependencies.

- [ ] **Step 4: Verify still builds**

Run: `pnpm run build`
Expected: Builds clean.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/package.json backend/pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(backend): install core deps (prisma/jwt/passport/swagger/redis)

Refs #3
EOF
)"
```

---

### Task 3: Configure TypeScript strict mode and path aliases

**Files:**
- Modify: `backend/tsconfig.json`

- [ ] **Step 1: Update tsconfig.json**

Replace `backend/tsconfig.json` content with:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"],
      "@common/*": ["src/common/*"],
      "@config/*": ["src/config/*"],
      "@auth/*": ["src/auth/*"],
      "@user/*": ["src/user/*"],
      "@master/*": ["src/master/*"]
    },
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 2: Install tsconfig-paths**

Run from `backend/`:
```bash
pnpm add -D tsconfig-paths
```

- [ ] **Step 3: Update nest-cli.json to support paths**

Replace `backend/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.json"
  }
}
```

- [ ] **Step 4: Verify build still works**

Run: `pnpm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/tsconfig.json backend/nest-cli.json backend/package.json backend/pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(backend): enable strict mode + path aliases

Refs #3
EOF
)"
```

---

### Task 4: Configure ESLint + Prettier + Husky + Commitlint

**Files:**
- Modify: `backend/.eslintrc.js`
- Create: `backend/.prettierrc`
- Create: repo root `.husky/commit-msg` (extends existing setup if any)
- Create: `backend/commitlint.config.js`

- [ ] **Step 1: Install husky + commitlint**

Run from repo root:
```bash
pnpm add -DW husky @commitlint/cli @commitlint/config-conventional
```

- [ ] **Step 2: Create backend/commitlint.config.js**

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'build', 'ci'],
    ],
  },
};
```

- [ ] **Step 3: Replace backend/.eslintrc.js**

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['.eslintrc.js', 'dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

- [ ] **Step 4: Run lint + format**

```bash
cd backend
pnpm run lint
pnpm run format
```
Expected: Both succeed without errors.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/ .husky/ package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(backend): wire eslint+prettier+commitlint per CLAUDE.md

Refs #3
EOF
)"
```

---

### Task 5: Create .gitignore and .env.example

**Files:**
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/.env` (gitignored, copy from .env.example)

- [ ] **Step 1: Create backend/.gitignore**

```
# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
!.vscode/extensions.json

# Test
coverage/

# Prisma
prisma/migrations/*.lock
```

- [ ] **Step 2: Create backend/.env.example**

```
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="mysql://sougexianer:dev_password@localhost:3306/sougexianer_dev"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=replace_with_strong_random_secret_min_32_chars
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# WeChat MiniProgram (replace with real values)
WECHAT_APPID=wx_placeholder
WECHAT_APPSECRET=placeholder_secret

# Tencent SMS (replace with real values)
TENCENT_SECRET_ID=placeholder_id
TENCENT_SECRET_KEY=placeholder_key
TENCENT_SMS_SDK_APP_ID=1400000000
TENCENT_SMS_SIGN_NAME=搜个仙儿
TENCENT_SMS_TEMPLATE_ID=000000

# CORS
CORS_ORIGIN=http://localhost:8000,http://localhost:5173

# Logging
LOG_LEVEL=debug
```

- [ ] **Step 3: Copy .env**

Run from `backend/`:
```bash
cp .env.example .env
```

- [ ] **Step 4: Verify .env is gitignored**

Run: `git check-ignore backend/.env`
Expected: outputs `backend/.env` (means it IS ignored).

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/.gitignore backend/.env.example
git commit -m "$(cat <<'EOF'
chore(backend): add gitignore and .env.example

Refs #3
EOF
)"
```

---

## Phase B — Local Dev Infrastructure

### Task 6: Docker Compose for MySQL + Redis (local dev)

**Files:**
- Create: `backend/docker-compose.dev.yml`

- [ ] **Step 1: Create docker-compose.dev.yml**

```yaml
version: '3.8'
services:
  mysql:
    image: mysql:8.0
    container_name: sougexianer_mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: root_password
      MYSQL_DATABASE: sougexianer_dev
      MYSQL_USER: sougexianer
      MYSQL_PASSWORD: dev_password
    ports:
      - '3306:3306'
    volumes:
      - sougexianer_mysql_data:/var/lib/mysql
    command:
      - --default-authentication-plugin=mysql_native_password
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-uroot', '-proot_password']
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: sougexianer_redis
    restart: unless-stopped
    ports:
      - '6379:6379'
    volumes:
      - sougexianer_redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  sougexianer_mysql_data:
  sougexianer_redis_data:
```

- [ ] **Step 2: Start the services**

Run from `backend/`:
```bash
docker compose -f docker-compose.dev.yml up -d
```
Expected: `sougexianer_mysql` and `sougexianer_redis` containers running.

- [ ] **Step 3: Verify health**

```bash
docker compose -f docker-compose.dev.yml ps
```
Expected: Both services show `(healthy)` status (may take 30 seconds for MySQL).

- [ ] **Step 4: Test connectivity**

```bash
docker exec sougexianer_mysql mysql -uroot -proot_password -e "SHOW DATABASES;"
docker exec sougexianer_redis redis-cli ping
```
Expected: MySQL lists `sougexianer_dev`; Redis returns `PONG`.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/docker-compose.dev.yml
git commit -m "$(cat <<'EOF'
chore(backend): add docker-compose for local mysql/redis

Refs #3
EOF
)"
```

---

### Task 7: Create env validation schema

**Files:**
- Create: `backend/src/config/env.validation.ts`
- Create: `backend/src/config/config.module.ts`
- Create: `backend/src/config/config.service.ts`

- [ ] **Step 1: Create env.validation.ts**

```typescript
// backend/src/config/env.validation.ts
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  WECHAT_APPID: Joi.string().required(),
  WECHAT_APPSECRET: Joi.string().required(),

  TENCENT_SECRET_ID: Joi.string().required(),
  TENCENT_SECRET_KEY: Joi.string().required(),
  TENCENT_SMS_SDK_APP_ID: Joi.string().required(),
  TENCENT_SMS_SIGN_NAME: Joi.string().required(),
  TENCENT_SMS_TEMPLATE_ID: Joi.string().required(),

  CORS_ORIGIN: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
});
```

- [ ] **Step 2: Create config.service.ts**

```typescript
// backend/src/config/config.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService) {}

  get nodeEnv(): string {
    return this.config.getOrThrow<string>('NODE_ENV');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.config.getOrThrow<number>('PORT');
  }
  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }
  get redis() {
    return {
      host: this.config.getOrThrow<string>('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }
  get jwt() {
    return {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
      refreshExpiresIn: this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    };
  }
  get wechat() {
    return {
      appId: this.config.getOrThrow<string>('WECHAT_APPID'),
      appSecret: this.config.getOrThrow<string>('WECHAT_APPSECRET'),
    };
  }
  get tencentSms() {
    return {
      secretId: this.config.getOrThrow<string>('TENCENT_SECRET_ID'),
      secretKey: this.config.getOrThrow<string>('TENCENT_SECRET_KEY'),
      sdkAppId: this.config.getOrThrow<string>('TENCENT_SMS_SDK_APP_ID'),
      signName: this.config.getOrThrow<string>('TENCENT_SMS_SIGN_NAME'),
      templateId: this.config.getOrThrow<string>('TENCENT_SMS_TEMPLATE_ID'),
    };
  }
  get corsOrigin(): string[] {
    return this.config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((s) => s.trim());
  }
}
```

- [ ] **Step 3: Create config.module.ts**

```typescript
// backend/src/config/config.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';
import { AppConfigService } from './config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
```

- [ ] **Step 4: Wire into app.module.ts**

Replace `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';

@Module({
  imports: [AppConfigModule],
})
export class AppModule {}
```

Delete `backend/src/app.controller.ts`, `backend/src/app.controller.spec.ts`, `backend/src/app.service.ts` (no longer needed).

- [ ] **Step 5: Run and verify**

```bash
cd backend
pnpm run start:dev
```
Expected: Starts on port 3000, no env validation errors logged.

Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/config backend/src/app.module.ts
git rm backend/src/app.controller.ts backend/src/app.controller.spec.ts backend/src/app.service.ts
git commit -m "$(cat <<'EOF'
feat(backend): add typed AppConfigService with joi env validation

Refs #3
EOF
)"
```

---

### Task 8: Test env validation rejects bad config

**Files:**
- Create: `backend/src/config/env.validation.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/config/env.validation.spec.ts
import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'mysql://x:y@localhost:3306/z',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRES_IN: '7d',
    JWT_REFRESH_EXPIRES_IN: '30d',
    WECHAT_APPID: 'wx_test',
    WECHAT_APPSECRET: 'secret',
    TENCENT_SECRET_ID: 'id',
    TENCENT_SECRET_KEY: 'key',
    TENCENT_SMS_SDK_APP_ID: '1400000000',
    TENCENT_SMS_SIGN_NAME: '搜个仙儿',
    TENCENT_SMS_TEMPLATE_ID: '000000',
    CORS_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
  };

  it('accepts a valid env object', () => {
    const { error } = envValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
  });

  it('rejects JWT_SECRET shorter than 32 chars', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      JWT_SECRET: 'tooshort',
    });
    expect(error).toBeDefined();
    expect(error?.details[0].message).toMatch(/JWT_SECRET/);
  });

  it('rejects invalid NODE_ENV', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      NODE_ENV: 'staging',
    });
    expect(error).toBeDefined();
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _unused, ...without } = validEnv;
    const { error } = envValidationSchema.validate(without);
    expect(error).toBeDefined();
    expect(error?.details[0].message).toMatch(/DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Run to verify it fails before code change**

(env.validation.ts already exists from Task 7; this test should pass immediately. Skip the "fails first" check for spec-test that exercises existing code.)

Run: `pnpm test src/config/env.validation.spec.ts`
Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/config/env.validation.spec.ts
git commit -m "$(cat <<'EOF'
test(backend): verify env validation schema rejects bad config

Refs #3
EOF
)"
```

---

### Task 9: Wire main.ts with logger and shutdown hooks

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Replace main.ts**

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`🚀 Backend running on http://localhost:${config.port}`, 'Bootstrap');
}
bootstrap();
```

- [ ] **Step 2: Run server**

```bash
cd backend
pnpm run start:dev
```
Expected: Log shows `🚀 Backend running on http://localhost:3000`.

- [ ] **Step 3: Stop and commit**

```bash
# Ctrl+C to stop
cd ..
git add backend/src/main.ts
git commit -m "$(cat <<'EOF'
feat(backend): wire main.ts with CORS, ValidationPipe, shutdown hooks

Refs #3
EOF
)"
```

---

## Phase C — Prisma Schema & Migration

### Task 10: Initialize Prisma

**Files:**
- Create: `backend/prisma/schema.prisma`

- [ ] **Step 1: Run prisma init**

```bash
cd backend
pnpm exec prisma init --datasource-provider mysql
```
Expected: Creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env` (will merge with existing).

- [ ] **Step 2: Verify schema.prisma stub**

```bash
cat prisma/schema.prisma
```
Expected: Shows generator + datasource blocks pointing to MySQL.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/prisma/ backend/.env.example
git commit -m "$(cat <<'EOF'
chore(backend): prisma init (mysql)

Refs #3
EOF
)"
```

---

### Task 11: Define User and Master models in schema.prisma

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Replace schema.prisma content**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ============= USERS & MASTERS =============

model User {
  id            String   @id @default(cuid())
  openid        String   @unique
  unionid       String?
  nickname      String?
  avatar        String?  @db.VarChar(500)
  phone         String?
  realname      String?
  status        UserStatus @default(ACTIVE)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([unionid])
  @@map("users")
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

model Master {
  id              String   @id @default(cuid())
  invitedByUserId String?  // creator's user id (you / 太太)
  phone           String   @unique
  unionid         String?  @unique
  realname        String?
  realnameVerified Boolean @default(false)
  idNumberHash    String?  // 身份证号哈希，不存明文

  // Profile fields
  displayName     String   @db.VarChar(100)
  avatar          String   @db.VarChar(500)
  intro           String   @db.VarChar(200) // 简介 ≤50 字
  experience      String   @db.Text         // 师承经历
  philosophy      String   @db.Text         // 解读理念
  videoUrl        String?  @db.VarChar(500) // 自述视频
  methods         Json     // 擅长方式 string[]
  topics          Json     // 擅长事项 string[]
  badges          Json     @default("[]") // 徽章 string[]

  status          MasterStatus @default(PENDING)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("masters")
}

enum MasterStatus {
  PENDING        // 入驻审核中
  ACTIVE         // 上架
  SUSPENDED      // 暂停接单
  REMOVED        // 永久下架
}
```

- [ ] **Step 2: Format the schema**

```bash
cd backend
pnpm exec prisma format
```

- [ ] **Step 3: Commit (migration follows in Task 15)**

```bash
cd ..
git add backend/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(backend): add User and Master models to prisma schema

Refs #3
EOF
)"
```

---

### Task 12: Define ServiceSKU and Order models

**Files:**
- Modify: `backend/prisma/schema.prisma` (append models)

- [ ] **Step 1: Append models to schema.prisma**

Add to the end of `backend/prisma/schema.prisma`:

```prisma
// ============= SERVICE SKU =============

model ServiceSKU {
  id           String      @id @default(cuid())
  masterId     String
  master       Master      @relation(fields: [masterId], references: [id], onDelete: Cascade)
  name         String      @db.VarChar(100)
  type         ServiceType
  price        Int         // 单位：分
  durationMin  Int?        // 实时类：分钟数
  deliveryHour Int?        // 异步类：承诺交付小时数
  description  String      @db.Text
  status       SKUStatus   @default(ACTIVE)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  @@index([masterId])
  @@map("service_skus")
}

enum ServiceType {
  ASYNC_REPORT
  REALTIME_IM
}

enum SKUStatus {
  ACTIVE
  DISABLED
}

// ============= ORDERS =============

model Order {
  id              String     @id @default(cuid())
  userId          String
  masterId        String
  skuId           String
  skuSnapshot     Json       // SKU 下单时快照
  state           OrderState @default(PENDING_ACCEPT)
  scheduledAt     DateTime?  // 实时类：预约时间
  conversationId  String

  originalPrice   Int
  finalPrice      Int
  platformFee     Int        // 10% 抽佣

  createdAt       DateTime   @default(now())
  acceptedAt      DateTime?
  deliveredAt     DateTime?
  completedAt     DateTime?
  updatedAt       DateTime   @updatedAt

  @@index([userId])
  @@index([masterId])
  @@index([state])
  @@map("orders")
}

enum OrderState {
  PENDING_ACCEPT       // 已下单待师傅接单
  ACCEPTED             // 师傅已接单
  PENDING_PAYMENT      // 实时类：双方确认时段待支付
  PAID                 // 实时类：已支付待到点
  IN_PROGRESS          // 处理中 / 咨询中
  DELIVERED            // 已交付（异步类）
  CONSULTATION_ENDED   // 咨询结束（实时类）
  COMPLETED            // 已完成
  CANCELLED            // 已取消
  REFUNDED             // 已退款
  IN_DISPUTE           // 仲裁中
}

model PriceChange {
  id          String   @id @default(cuid())
  orderId     String
  fromPrice   Int
  toPrice     Int
  reason      String   @db.Text
  status      PriceChangeStatus @default(PENDING)
  decidedAt   DateTime?
  createdAt   DateTime @default(now())

  @@index([orderId])
  @@map("price_changes")
}

enum PriceChangeStatus {
  PENDING
  ACCEPTED
  REJECTED
}
```

Add to the `Master` model after `badges`:
```prisma
  skus            ServiceSKU[]
```

- [ ] **Step 2: Format**

```bash
cd backend
pnpm exec prisma format
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(backend): add ServiceSKU, Order, PriceChange models

Refs #3
EOF
)"
```

---

### Task 13: Define Conversation and Message models

**Files:**
- Modify: `backend/prisma/schema.prisma` (append)

- [ ] **Step 1: Append to schema.prisma**

```prisma
// ============= IM CONVERSATION =============

model Conversation {
  id                String   @id @default(cuid())
  userId            String
  masterId          String
  unrespondedCount  Int      @default(0)  // 用户已发未回数 (售前限额)
  masterHasReplied  Boolean  @default(false)
  hasOrder          Boolean  @default(false)
  lastMessageAt     DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  messages          Message[]

  @@unique([userId, masterId])
  @@index([userId])
  @@index([masterId])
  @@map("conversations")
}

model Message {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId        String
  senderType      SenderType
  type            MessageType
  content         String        @db.Text  // 文本 / 媒体 URL / system_card JSON
  systemCardData  Json?         // system_card 载荷
  relatedOrderId  String?
  auditStatus     AuditStatus   @default(PASS)
  createdAt       DateTime      @default(now())

  @@index([conversationId])
  @@index([senderId])
  @@map("messages")
}

enum SenderType {
  USER
  MASTER
  SYSTEM
}

enum MessageType {
  TEXT
  VOICE
  IMAGE
  SYSTEM_CARD
}

enum AuditStatus {
  PENDING
  PASS
  REJECTED
}
```

- [ ] **Step 2: Format**

```bash
cd backend
pnpm exec prisma format
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(backend): add Conversation and Message models

Refs #3
EOF
)"
```

---

### Task 14: Define Review, DisputeCase, and supporting models

**Files:**
- Modify: `backend/prisma/schema.prisma` (append)

- [ ] **Step 1: Append to schema.prisma**

```prisma
// ============= REVIEW =============

model Review {
  id              String   @id @default(cuid())
  orderId         String   @unique
  userId          String
  masterId        String
  professional    Int      // 1-5 解读专业度
  patience        Int      // 1-5 沟通耐心
  ritual          Int      // 1-5 仪式感
  valueForMoney   Int      // 1-5 性价比
  tags            Json     @default("[]")  // string[]
  content         String   @db.Text
  images          Json     @default("[]")  // URL[] max 6
  masterReply     String?  @db.Text
  masterReplyAt   DateTime?
  isActive        Boolean  @default(false) // 24h 冷却后 true
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([masterId])
  @@map("reviews")
}

// ============= DISPUTE =============

model DisputeCase {
  id              String         @id @default(cuid())
  orderId         String         @unique
  userId          String
  reason          String         @db.VarChar(100)
  userStatement   String         @db.Text
  evidence        Json           @default("[]")  // URL[]
  masterStatement String?        @db.Text
  ruling          DisputeRuling?
  rulingReason    String?        @db.Text
  resolvedAt      DateTime?
  createdAt       DateTime       @default(now())

  @@map("dispute_cases")
}

enum DisputeRuling {
  FULL_REFUND
  PARTIAL_REFUND
  DISMISS
}

// ============= ASSETS & SCHEDULES =============

model Asset {
  id           String     @id @default(cuid())
  ownerId      String     // user id or master id
  ownerType    AssetOwner
  category     String     // "avatar" | "intro_video" | "case_image" | "artifact_report" | ...
  url          String     @db.VarChar(500)
  metadata     Json?      // { size, duration, contentType, etc. }
  relatedOrderId String?
  createdAt    DateTime   @default(now())

  @@index([ownerId])
  @@map("assets")
}

enum AssetOwner {
  USER
  MASTER
}

model Schedule {
  id          String   @id @default(cuid())
  masterId    String
  dayOfWeek   Int      // 0-6 (Sun-Sat)
  startTime   String   // "19:00"
  endTime     String   // "22:00"
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())

  @@index([masterId])
  @@map("schedules")
}

// ============= SETTLEMENT =============

model Settlement {
  id          String   @id @default(cuid())
  masterId    String
  amount      Int      // 单位：分
  type        SettlementType
  status      SettlementStatus @default(PENDING)
  relatedOrderId String?
  withdrawTxnId  String?  // 提现时微信支付的交易号
  createdAt   DateTime @default(now())
  settledAt   DateTime?

  @@index([masterId])
  @@map("settlements")
}

enum SettlementType {
  EARNING       // 订单完成入账
  WITHDRAW      // 提现
  REFUND_DEDUCT // 退款扣回
}

enum SettlementStatus {
  PENDING
  COMPLETED
  FAILED
}

// ============= FAVORITES =============

model Favorite {
  id        String   @id @default(cuid())
  userId    String
  masterId  String
  createdAt DateTime @default(now())

  @@unique([userId, masterId])
  @@map("favorites")
}
```

Add to `User` model:
```prisma
  favorites Favorite[]
```

Add to `Master` model:
```prisma
  schedules Schedule[]
  settlements Settlement[]
```

- [ ] **Step 2: Format**

```bash
cd backend
pnpm exec prisma format
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(backend): add Review/Dispute/Asset/Schedule/Settlement/Favorite models

Refs #3
EOF
)"
```

---

### Task 15: Run initial migration

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_init/migration.sql`

- [ ] **Step 1: Run migration**

```bash
cd backend
pnpm exec prisma migrate dev --name init
```
Expected: Creates `prisma/migrations/<timestamp>_init/migration.sql` and applies it to `sougexianer_dev`.

- [ ] **Step 2: Verify tables**

```bash
docker exec sougexianer_mysql mysql -uroot -proot_password sougexianer_dev -e "SHOW TABLES;"
```
Expected: Lists all tables (`users`, `masters`, `service_skus`, `orders`, `conversations`, `messages`, `reviews`, etc.).

- [ ] **Step 3: Generate Prisma Client**

```bash
pnpm exec prisma generate
```
Expected: `node_modules/@prisma/client` is regenerated.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/prisma/migrations
git commit -m "$(cat <<'EOF'
feat(backend): initial prisma migration (all core models)

Refs #3
EOF
)"
```

---

## Phase D — Common Infra Modules

### Task 16: Create global PrismaModule + PrismaService

**Files:**
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create PrismaService**

```typescript
// backend/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
```

- [ ] **Step 2: Create PrismaModule (global)**

```typescript
// backend/src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Wire into AppModule**

Replace `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [AppConfigModule, PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify boot succeeds**

```bash
cd backend
pnpm run start:dev
```
Expected: Log includes `Prisma connected`. No errors. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/src/prisma backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(backend): add global PrismaModule

Refs #3
EOF
)"
```

---

### Task 17: Create global RedisModule + RedisService

**Files:**
- Create: `backend/src/redis/redis.service.ts`
- Create: `backend/src/redis/redis.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create RedisService**

```typescript
// backend/src/redis/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: AppConfigService) {
    super({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit() {
    await this.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await this.quit();
    this.logger.log('Redis disconnected');
  }
}
```

- [ ] **Step 2: Create RedisModule (global)**

```typescript
// backend/src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 3: Wire into AppModule**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify**

```bash
cd backend && pnpm run start:dev
```
Expected: `Prisma connected` AND `Redis connected` both logged. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/src/redis backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(backend): add global RedisModule (ioredis)

Refs #3
EOF
)"
```

---

### Task 18: Global exception filter

**Files:**
- Create: `backend/src/common/filters/all-exceptions.filter.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Create filter**

```typescript
// backend/src/common/filters/all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : (exception as Error)?.message || 'Internal server error';

    const errorBody = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status}`);
    }

    response.status(status).json(errorBody);
  }
}
```

- [ ] **Step 2: Wire into main.ts**

In `backend/src/main.ts`, after `app.useGlobalPipes(...)`:

```typescript
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
// ...
app.useGlobalFilters(new AllExceptionsFilter());
```

- [ ] **Step 3: Verify boot**

```bash
cd backend && pnpm run start:dev
```
Expected: Starts cleanly. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/common/filters backend/src/main.ts
git commit -m "$(cat <<'EOF'
feat(backend): add global AllExceptionsFilter

Refs #3
EOF
)"
```

---

### Task 19: Global response interceptor

**Files:**
- Create: `backend/src/common/interceptors/response.interceptor.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Create interceptor**

```typescript
// backend/src/common/interceptors/response.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<SuccessResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

- [ ] **Step 2: Wire into main.ts**

In `backend/src/main.ts`:

```typescript
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
// ...
app.useGlobalInterceptors(new ResponseInterceptor());
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/common/interceptors backend/src/main.ts
git commit -m "$(cat <<'EOF'
feat(backend): add ResponseInterceptor (uniform success envelope)

Refs #3
EOF
)"
```

---

### Task 20: Health check endpoint + Swagger

**Files:**
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Create HealthController**

```typescript
// backend/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
    ]);
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      mysql: dbOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
    };
  }
}
```

- [ ] **Step 2: Create HealthModule**

```typescript
// backend/src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 3: Wire into AppModule**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, HealthModule],
})
export class AppModule {}
```

- [ ] **Step 4: Add Swagger to main.ts**

In `backend/src/main.ts`, before `await app.listen(...)`:

```typescript
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
// ...
if (!config.isProduction) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('搜个仙儿 API')
    .setDescription('Backend API for 搜个仙儿 MVP')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}
```

- [ ] **Step 5: Verify**

```bash
cd backend && pnpm run start:dev
```

In another terminal:
```bash
curl http://localhost:3000/health
```
Expected:
```json
{"success":true,"data":{"status":"ok","mysql":"ok","redis":"ok"},"timestamp":"..."}
```

Open browser → `http://localhost:3000/docs`. Expected: Swagger UI showing the `health` tag.

Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/health backend/src/app.module.ts backend/src/main.ts
git commit -m "$(cat <<'EOF'
feat(backend): add /health endpoint + Swagger UI at /docs

Refs #3
EOF
)"
```

---

## Phase E — External Service Wrappers

### Task 21: WechatService.code2Session — write failing test

**Files:**
- Create: `backend/src/wechat/wechat.service.ts`
- Create: `backend/src/wechat/wechat.service.spec.ts`
- Create: `backend/src/wechat/wechat.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/wechat/wechat.service.spec.ts
import { Test } from '@nestjs/testing';
import { WechatService } from './wechat.service';
import { AppConfigService } from '../config/config.service';

describe('WechatService', () => {
  let service: WechatService;
  let mockHttp: jest.Mock;

  beforeEach(async () => {
    mockHttp = jest.fn();
    global.fetch = mockHttp as unknown as typeof fetch;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatService,
        {
          provide: AppConfigService,
          useValue: {
            wechat: { appId: 'wx_test', appSecret: 'secret_test' },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(WechatService);
  });

  describe('code2Session', () => {
    it('returns openid + session_key on success', async () => {
      mockHttp.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          openid: 'wx_openid_abc',
          session_key: 'session_key_xyz',
          unionid: 'wx_union_123',
        }),
      });

      const result = await service.code2Session('mock_code');
      expect(result).toEqual({
        openid: 'wx_openid_abc',
        sessionKey: 'session_key_xyz',
        unionid: 'wx_union_123',
      });
      expect(mockHttp).toHaveBeenCalledWith(
        expect.stringContaining('appid=wx_test'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws when WeChat returns errcode', async () => {
      mockHttp.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
      });

      await expect(service.code2Session('bad_code')).rejects.toThrow(
        /invalid code/,
      );
    });
  });
});
```

- [ ] **Step 2: Run test (should fail — service doesn't exist yet)**

```bash
cd backend
pnpm test src/wechat/wechat.service.spec.ts 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './wechat.service'`.

- [ ] **Step 3: Create WechatService**

```typescript
// backend/src/wechat/wechat.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

export interface Code2SessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  constructor(private readonly config: AppConfigService) {}

  async code2Session(code: string): Promise<Code2SessionResult> {
    const { appId, appSecret } = this.config.wechat;
    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;

    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      throw new BadRequestException(`WeChat code2session HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      openid?: string;
      session_key?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode) {
      this.logger.warn(`code2session errcode=${data.errcode} msg=${data.errmsg}`);
      throw new BadRequestException(`WeChat code2session: ${data.errmsg}`);
    }
    return {
      openid: data.openid!,
      sessionKey: data.session_key!,
      unionid: data.unionid,
    };
  }
}
```

- [ ] **Step 4: Run test again (should pass)**

```bash
pnpm test src/wechat/wechat.service.spec.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Create WechatModule**

```typescript
// backend/src/wechat/wechat.module.ts
import { Module } from '@nestjs/common';
import { WechatService } from './wechat.service';

@Module({
  providers: [WechatService],
  exports: [WechatService],
})
export class WechatModule {}
```

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/wechat
git commit -m "$(cat <<'EOF'
feat(backend): add WechatService.code2Session with mock test

Refs #4
EOF
)"
```

---

### Task 22: SmsService with mock test

**Files:**
- Create: `backend/src/sms/sms.service.ts`
- Create: `backend/src/sms/sms.service.spec.ts`
- Create: `backend/src/sms/sms.module.ts`

- [ ] **Step 1: Install tencentcloud SDK**

```bash
cd backend
pnpm add tencentcloud-sdk-nodejs-sms
```

- [ ] **Step 2: Write failing test**

```typescript
// backend/src/sms/sms.service.spec.ts
import { Test } from '@nestjs/testing';
import { SmsService } from './sms.service';
import { AppConfigService } from '../config/config.service';

const mockSendSms = jest.fn();
jest.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: jest.fn().mockImplementation(() => ({
        SendSms: mockSendSms,
      })),
    },
  },
}));

describe('SmsService', () => {
  let service: SmsService;

  beforeEach(async () => {
    mockSendSms.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsService,
        {
          provide: AppConfigService,
          useValue: {
            tencentSms: {
              secretId: 'sid',
              secretKey: 'sk',
              sdkAppId: '1400000000',
              signName: '搜个仙儿',
              templateId: '000000',
            },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(SmsService);
  });

  it('sends a verification code via Tencent SMS', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800138000' }],
    });
    await service.sendVerificationCode('13800138000', '123456');
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        PhoneNumberSet: ['+8613800138000'],
        TemplateParamSet: ['123456'],
      }),
    );
  });

  it('throws when SMS returns non-Ok status', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'LimitExceeded', PhoneNumber: '+8613800138000', Message: 'rate' }],
    });
    await expect(service.sendVerificationCode('13800138000', '123456')).rejects.toThrow(
      /LimitExceeded/,
    );
  });
});
```

- [ ] **Step 3: Run test (should fail)**

```bash
pnpm test src/sms/sms.service.spec.ts 2>&1 | tail -10
```
Expected: FAIL — service doesn't exist.

- [ ] **Step 4: Create SmsService**

```typescript
// backend/src/sms/sms.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { sms } from 'tencentcloud-sdk-nodejs-sms';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: InstanceType<typeof sms.v20210111.Client>;

  constructor(private readonly config: AppConfigService) {
    this.client = new sms.v20210111.Client({
      credential: {
        secretId: config.tencentSms.secretId,
        secretKey: config.tencentSms.secretKey,
      },
      region: 'ap-guangzhou',
    });
  }

  async sendVerificationCode(phone: string, code: string): Promise<void> {
    const params = {
      SmsSdkAppId: this.config.tencentSms.sdkAppId,
      SignName: this.config.tencentSms.signName,
      TemplateId: this.config.tencentSms.templateId,
      TemplateParamSet: [code],
      PhoneNumberSet: [`+86${phone}`],
    };

    const resp = await this.client.SendSms(params);
    const status = resp.SendStatusSet?.[0];
    if (!status || status.Code !== 'Ok') {
      this.logger.warn(`SMS failed: ${status?.Code} ${status?.Message}`);
      throw new BadRequestException(
        `SMS send failed: ${status?.Code} ${status?.Message}`,
      );
    }
  }
}
```

- [ ] **Step 5: Run test (should pass)**

```bash
pnpm test src/sms/sms.service.spec.ts
```
Expected: 2 tests PASS.

- [ ] **Step 6: Create SmsModule**

```typescript
// backend/src/sms/sms.module.ts
import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
```

- [ ] **Step 7: Commit**

```bash
cd ..
git add backend/src/sms backend/package.json backend/pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(backend): add SmsService (tencent sms) with mock test

Refs #4
EOF
)"
```

---

## Phase F — User 微信登录

### Task 23: UserService.findOrCreateByOpenid

**Files:**
- Create: `backend/src/user/user.service.ts`
- Create: `backend/src/user/user.service.spec.ts`
- Create: `backend/src/user/user.module.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/user/user.service.spec.ts
import { Test } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(UserService);
  });

  describe('findOrCreateByOpenid', () => {
    it('returns existing user when openid matches', async () => {
      const existing = { id: 'u1', openid: 'wx_abc', unionid: null };
      prisma.user.findUnique.mockResolvedValue(existing);
      const result = await service.findOrCreateByOpenid('wx_abc');
      expect(result).toBe(existing);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates new user when openid is new', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = { id: 'u_new', openid: 'wx_new', unionid: null };
      prisma.user.create.mockResolvedValue(created);
      const result = await service.findOrCreateByOpenid('wx_new');
      expect(result).toBe(created);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { openid: 'wx_new' },
      });
    });

    it('updates unionid if provided and missing on existing user', async () => {
      const existing = { id: 'u1', openid: 'wx_abc', unionid: null };
      prisma.user.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, unionid: 'wx_uni' };
      prisma.user.update.mockResolvedValue(updated);
      const result = await service.findOrCreateByOpenid('wx_abc', 'wx_uni');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { unionid: 'wx_uni' },
      });
      expect(result).toBe(updated);
    });
  });
});
```

- [ ] **Step 2: Run test (fails)**

```bash
pnpm test src/user/user.service.spec.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Create UserService**

```typescript
// backend/src/user/user.service.ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByOpenid(openid: string, unionid?: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { openid } });
    if (existing) {
      if (unionid && !existing.unionid) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { unionid },
        });
      }
      return existing;
    }
    return this.prisma.user.create({
      data: { openid, ...(unionid ? { unionid } : {}) },
    });
  }
}
```

Wait — the test for the "new user" case expects `data: { openid: 'wx_new' }` without unionid even when none provided. The implementation above conditionally adds unionid only when provided. Let me verify: in the test, `findOrCreateByOpenid('wx_new')` is called with no unionid → expectation is `data: { openid: 'wx_new' }`. The implementation handles this correctly (spread is empty object).

- [ ] **Step 4: Run test (passes)**

```bash
pnpm test src/user/user.service.spec.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Create UserModule**

```typescript
// backend/src/user/user.module.ts
import { Module } from '@nestjs/common';
import { UserService } from './user.service';

@Module({
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/user
git commit -m "$(cat <<'EOF'
feat(backend): add UserService.findOrCreateByOpenid

Refs #4
EOF
)"
```

---

### Task 24: Auth DTOs

**Files:**
- Create: `backend/src/auth/dto/login-wechat.dto.ts`
- Create: `backend/src/auth/dto/send-sms.dto.ts`
- Create: `backend/src/auth/dto/login-master-phone.dto.ts`

- [ ] **Step 1: Create login-wechat.dto.ts**

```typescript
// backend/src/auth/dto/login-wechat.dto.ts
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginWechatDto {
  @ApiProperty({ description: '微信 wx.login 返回的 code' })
  @IsString()
  @MinLength(1)
  code!: string;
}
```

- [ ] **Step 2: Create send-sms.dto.ts**

```typescript
// backend/src/auth/dto/send-sms.dto.ts
import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendSmsDto {
  @ApiProperty({ description: '11 位手机号 (不含国际区号)', example: '13800138000' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;
}
```

- [ ] **Step 3: Create login-master-phone.dto.ts**

```typescript
// backend/src/auth/dto/login-master-phone.dto.ts
import { IsString, Matches, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginMasterPhoneDto {
  @ApiProperty({ description: '手机号' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @ApiProperty({ description: '6 位短信验证码' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
```

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/auth/dto
git commit -m "$(cat <<'EOF'
feat(backend): add auth DTOs (LoginWechat / SendSms / LoginMasterPhone)

Refs #4
EOF
)"
```

---

### Task 25: AuthService.loginWithWechat + JWT issuance

**Files:**
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { AppConfigService } from '../config/config.service';

describe('AuthService', () => {
  let service: AuthService;
  let wechat: { code2Session: jest.Mock };
  let userSvc: { findOrCreateByOpenid: jest.Mock };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    wechat = { code2Session: jest.fn() };
    userSvc = { findOrCreateByOpenid: jest.fn() };
    jwt = { sign: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: WechatService, useValue: wechat },
        { provide: UserService, useValue: userSvc },
        { provide: JwtService, useValue: jwt },
        {
          provide: AppConfigService,
          useValue: {
            jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('loginWithWechat', () => {
    it('exchanges code, finds/creates user, returns JWT pair', async () => {
      wechat.code2Session.mockResolvedValue({
        openid: 'wx_abc',
        sessionKey: 'sk',
        unionid: 'wx_uni',
      });
      userSvc.findOrCreateByOpenid.mockResolvedValue({
        id: 'u1',
        openid: 'wx_abc',
        unionid: 'wx_uni',
      });
      jwt.sign
        .mockReturnValueOnce('access_jwt')
        .mockReturnValueOnce('refresh_jwt');

      const result = await service.loginWithWechat('mock_code');

      expect(wechat.code2Session).toHaveBeenCalledWith('mock_code');
      expect(userSvc.findOrCreateByOpenid).toHaveBeenCalledWith('wx_abc', 'wx_uni');
      expect(result).toEqual({
        accessToken: 'access_jwt',
        refreshToken: 'refresh_jwt',
        userId: 'u1',
      });
      // Verify JWT payload contains role USER
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sub: 'u1', role: 'USER' }),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test (fails)**

```bash
pnpm test src/auth/auth.service.spec.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Create AuthService**

```typescript
// backend/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { AppConfigService } from '../config/config.service';

export type Role = 'USER' | 'MASTER' | 'ADMIN';

export interface JwtPayload {
  sub: string;
  role: Role;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async loginWithWechat(code: string): Promise<LoginResult> {
    const { openid, unionid } = await this.wechat.code2Session(code);
    const user = await this.users.findOrCreateByOpenid(openid, unionid);
    return this.issueTokens(user.id, 'USER');
  }

  private issueTokens(subjectId: string, role: Role): LoginResult {
    const payload: JwtPayload = { sub: subjectId, role };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: this.config.jwt.expiresIn }),
      refreshToken: this.jwt.sign(payload, { expiresIn: this.config.jwt.refreshExpiresIn }),
      userId: subjectId,
    };
  }
}
```

- [ ] **Step 4: Run test (passes)**

```bash
pnpm test src/auth/auth.service.spec.ts
```
Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(backend): add AuthService.loginWithWechat + JWT issuance

Refs #4
EOF
)"
```

---

### Task 26: AuthController + AuthModule + wiring

**Files:**
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/strategies/jwt.strategy.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create JWT strategy**

```typescript
// backend/src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../config/config.service';
import { JwtPayload, Role } from '../auth.service';

export interface AuthenticatedUser {
  id: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return { id: payload.sub, role: payload.role };
  }
}
```

- [ ] **Step 2: Create AuthController**

```typescript
// backend/src/auth/auth.controller.ts
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginWechatDto } from './dto/login-wechat.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login/wechat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户微信登录 (wx.login → code → JWT)' })
  loginWechat(@Body() dto: LoginWechatDto) {
    return this.authService.loginWithWechat(dto.code);
  }
}
```

- [ ] **Step 3: Create AuthModule**

```typescript
// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WechatModule } from '../wechat/wechat.module';
import { UserModule } from '../user/user.module';
import { AppConfigService } from '../config/config.service';

@Module({
  imports: [
    WechatModule,
    UserModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 4: Wire into AppModule**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Verify boots and Swagger shows /auth/login/wechat**

```bash
cd backend && pnpm run start:dev
```
Open http://localhost:3000/docs → expect `auth` tag with POST `/auth/login/wechat`.
Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/auth backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(backend): wire AuthController + JwtStrategy + AuthModule

Refs #4
EOF
)"
```

---

### Task 27: E2E test for POST /auth/login/wechat

**Files:**
- Create: `backend/test/e2e/auth-wechat.e2e-spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// backend/test/e2e/auth-wechat.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { WechatService } from '../../src/wechat/wechat.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('POST /auth/login/wechat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WechatService)
      .useValue({
        code2Session: jest.fn().mockResolvedValue({
          openid: 'e2e_openid_test',
          sessionKey: 'sk',
          unionid: 'e2e_unionid_test',
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);
    // Clean any existing test user
    await prisma.user.deleteMany({ where: { openid: 'e2e_openid_test' } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { openid: 'e2e_openid_test' } });
    await app.close();
  });

  it('returns access + refresh tokens for valid code', async () => {
    const resp = await request(app.getHttpServer())
      .post('/auth/login/wechat')
      .send({ code: 'mock_code' })
      .expect(200);

    expect(resp.body).toMatchObject({
      success: true,
      data: {
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        userId: expect.any(String),
      },
    });

    const created = await prisma.user.findUnique({ where: { openid: 'e2e_openid_test' } });
    expect(created).toBeTruthy();
    expect(created?.unionid).toBe('e2e_unionid_test');
  });

  it('rejects when code is missing', async () => {
    await request(app.getHttpServer())
      .post('/auth/login/wechat')
      .send({})
      .expect(400);
  });
});
```

- [ ] **Step 2: Verify Jest E2E config exists**

Check that `backend/test/jest-e2e.json` exists. If not (it should be from `nest new`), create it:

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [ ] **Step 3: Run E2E test**

```bash
cd backend
pnpm exec jest --config ./test/jest-e2e.json
```
Expected: Both tests PASS (need MySQL + Redis from docker compose running).

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/test/e2e/auth-wechat.e2e-spec.ts backend/test/jest-e2e.json
git commit -m "$(cat <<'EOF'
test(backend): add e2e for POST /auth/login/wechat

Refs #4
EOF
)"
```

---

## Phase G — 师傅 手机号登录

### Task 28: MasterService.findOrCreateByPhone + bindUnionid

**Files:**
- Create: `backend/src/master/master.service.ts`
- Create: `backend/src/master/master.service.spec.ts`
- Create: `backend/src/master/master.module.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/master/master.service.spec.ts
import { Test } from '@nestjs/testing';
import { MasterService } from './master.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MasterService', () => {
  let service: MasterService;
  let prisma: { master: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      master: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MasterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(MasterService);
  });

  describe('findOrCreateByPhone', () => {
    it('returns existing master', async () => {
      const existing = { id: 'm1', phone: '13800138000' };
      prisma.master.findUnique.mockResolvedValue(existing);
      const r = await service.findOrCreateByPhone('13800138000');
      expect(r).toBe(existing);
    });

    it('creates new master with PENDING status and placeholder profile', async () => {
      prisma.master.findUnique.mockResolvedValue(null);
      const created = { id: 'm2', phone: '13800138001' };
      prisma.master.create.mockResolvedValue(created);
      const r = await service.findOrCreateByPhone('13800138001');
      expect(prisma.master.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phone: '13800138001',
          status: 'PENDING',
          displayName: '',
          avatar: '',
          intro: '',
          experience: '',
          philosophy: '',
          methods: [],
          topics: [],
        }),
      });
      expect(r).toBe(created);
    });
  });

  describe('bindUnionid', () => {
    it('updates unionid for given master', async () => {
      const updated = { id: 'm1', unionid: 'wx_uni' };
      prisma.master.update.mockResolvedValue(updated);
      const r = await service.bindUnionid('m1', 'wx_uni');
      expect(prisma.master.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { unionid: 'wx_uni' },
      });
      expect(r).toBe(updated);
    });
  });
});
```

- [ ] **Step 2: Run (fails)**

```bash
pnpm test src/master/master.service.spec.ts 2>&1 | tail -10
```
Expected: FAIL.

- [ ] **Step 3: Create MasterService**

```typescript
// backend/src/master/master.service.ts
import { Injectable } from '@nestjs/common';
import { Master, MasterStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByPhone(phone: string): Promise<Master> {
    const existing = await this.prisma.master.findUnique({ where: { phone } });
    if (existing) return existing;
    return this.prisma.master.create({
      data: {
        phone,
        status: MasterStatus.PENDING,
        displayName: '',
        avatar: '',
        intro: '',
        experience: '',
        philosophy: '',
        methods: [],
        topics: [],
      },
    });
  }

  async bindUnionid(masterId: string, unionid: string): Promise<Master> {
    return this.prisma.master.update({
      where: { id: masterId },
      data: { unionid },
    });
  }
}
```

- [ ] **Step 4: Run (passes)**

```bash
pnpm test src/master/master.service.spec.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Create MasterModule**

```typescript
// backend/src/master/master.module.ts
import { Module } from '@nestjs/common';
import { MasterService } from './master.service';

@Module({
  providers: [MasterService],
  exports: [MasterService],
})
export class MasterModule {}
```

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/master
git commit -m "$(cat <<'EOF'
feat(backend): add MasterService.findOrCreateByPhone + bindUnionid

Refs #4
EOF
)"
```

---

### Task 29: AuthService — SMS code send + verify + master phone login

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.service.spec.ts` (add tests)
- Modify: `backend/src/auth/auth.module.ts` (import SmsModule + MasterModule + RedisModule already global)

- [ ] **Step 1: Add tests**

Append to `backend/src/auth/auth.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { SmsService } from '../sms/sms.service';
import { MasterService } from '../master/master.service';
import { RedisService } from '../redis/redis.service';

describe('AuthService (sms + master phone login)', () => {
  let service: AuthService;
  let sms: { sendVerificationCode: jest.Mock };
  let masters: { findOrCreateByPhone: jest.Mock };
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    sms = { sendVerificationCode: jest.fn() };
    masters = { findOrCreateByPhone: jest.fn() };
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    jwt = { sign: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: WechatService, useValue: { code2Session: jest.fn() } },
        { provide: UserService, useValue: { findOrCreateByOpenid: jest.fn() } },
        { provide: SmsService, useValue: sms },
        { provide: MasterService, useValue: masters },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwt },
        {
          provide: AppConfigService,
          useValue: { jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' } },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('sendSmsCode', () => {
    it('generates a 6-digit code, stores in Redis 5min, sends via SMS', async () => {
      redis.set.mockResolvedValue('OK');
      await service.sendSmsCode('13800138000');
      expect(redis.set).toHaveBeenCalledWith(
        'sms:code:13800138000',
        expect.stringMatching(/^\d{6}$/),
        'EX',
        300,
      );
      expect(sms.sendVerificationCode).toHaveBeenCalledWith(
        '13800138000',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('rate-limits: rejects if recent code sent within 60s', async () => {
      redis.get.mockResolvedValue('1'); // rate-limit key exists
      await expect(service.sendSmsCode('13800138000')).rejects.toThrow(
        /频繁/,
      );
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('loginMasterPhone', () => {
    it('verifies code, finds/creates master, returns JWT pair', async () => {
      redis.get.mockResolvedValueOnce('123456');
      masters.findOrCreateByPhone.mockResolvedValue({ id: 'm1', phone: '13800138000' });
      jwt.sign.mockReturnValueOnce('access').mockReturnValueOnce('refresh');

      const r = await service.loginMasterPhone('13800138000', '123456');
      expect(redis.get).toHaveBeenCalledWith('sms:code:13800138000');
      expect(redis.del).toHaveBeenCalledWith('sms:code:13800138000');
      expect(masters.findOrCreateByPhone).toHaveBeenCalledWith('13800138000');
      expect(r).toEqual({ accessToken: 'access', refreshToken: 'refresh', userId: 'm1' });
    });

    it('rejects when stored code does not match', async () => {
      redis.get.mockResolvedValueOnce('654321');
      await expect(service.loginMasterPhone('13800138000', '123456')).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects when no code exists (expired)', async () => {
      redis.get.mockResolvedValueOnce(null);
      await expect(service.loginMasterPhone('13800138000', '123456')).rejects.toThrow(
        /验证码已过期/,
      );
    });
  });
});
```

- [ ] **Step 2: Run (fails)**

```bash
pnpm test src/auth/auth.service.spec.ts 2>&1 | tail -15
```
Expected: FAIL — `service.sendSmsCode is not a function`.

- [ ] **Step 3: Extend AuthService**

Modify `backend/src/auth/auth.service.ts` — replace entire file with:

```typescript
// backend/src/auth/auth.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { SmsService } from '../sms/sms.service';
import { MasterService } from '../master/master.service';
import { RedisService } from '../redis/redis.service';
import { AppConfigService } from '../config/config.service';

export type Role = 'USER' | 'MASTER' | 'ADMIN';

export interface JwtPayload {
  sub: string;
  role: Role;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly users: UserService,
    private readonly sms: SmsService,
    private readonly masters: MasterService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async loginWithWechat(code: string): Promise<LoginResult> {
    const { openid, unionid } = await this.wechat.code2Session(code);
    const user = await this.users.findOrCreateByOpenid(openid, unionid);
    return this.issueTokens(user.id, 'USER');
  }

  async sendSmsCode(phone: string): Promise<void> {
    const rateKey = `sms:rate:${phone}`;
    const recent = await this.redis.get(rateKey);
    if (recent) {
      throw new BadRequestException('发送频繁，请稍后再试');
    }
    const code = this.generateSixDigitCode();
    await this.redis.set(`sms:code:${phone}`, code, 'EX', 300); // 5 min
    await this.redis.set(rateKey, '1', 'EX', 60); // 60s rate limit
    await this.sms.sendVerificationCode(phone, code);
  }

  async loginMasterPhone(phone: string, code: string): Promise<LoginResult> {
    const stored = await this.redis.get(`sms:code:${phone}`);
    if (!stored) {
      throw new BadRequestException('验证码已过期，请重新发送');
    }
    if (stored !== code) {
      throw new BadRequestException('验证码错误');
    }
    await this.redis.del(`sms:code:${phone}`);
    const master = await this.masters.findOrCreateByPhone(phone);
    return this.issueTokens(master.id, 'MASTER');
  }

  async bindMasterUnionid(masterId: string, code: string): Promise<{ unionid: string }> {
    const { unionid } = await this.wechat.code2Session(code);
    if (!unionid) {
      throw new BadRequestException('微信未返回 unionid，请确保已绑定开放平台');
    }
    await this.masters.bindUnionid(masterId, unionid);
    return { unionid };
  }

  private issueTokens(subjectId: string, role: Role): LoginResult {
    const payload: JwtPayload = { sub: subjectId, role };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: this.config.jwt.expiresIn }),
      refreshToken: this.jwt.sign(payload, { expiresIn: this.config.jwt.refreshExpiresIn }),
      userId: subjectId,
    };
  }

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
```

Update the existing first `describe('AuthService')` test setup in spec to include the new providers (or just leave the original test alone since it now needs to be updated to handle the new constructor — the new tests cover that). Quick fix: ensure existing test's `providers` array includes stubs for `SmsService`, `MasterService`, `RedisService`.

Modify the original (top of `auth.service.spec.ts`) `describe('AuthService')` test setup:

```typescript
  beforeEach(async () => {
    wechat = { code2Session: jest.fn() };
    userSvc = { findOrCreateByOpenid: jest.fn() };
    jwt = { sign: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: WechatService, useValue: wechat },
        { provide: UserService, useValue: userSvc },
        { provide: SmsService, useValue: { sendVerificationCode: jest.fn() } },
        { provide: MasterService, useValue: { findOrCreateByPhone: jest.fn(), bindUnionid: jest.fn() } },
        { provide: RedisService, useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() } },
        { provide: JwtService, useValue: jwt },
        {
          provide: AppConfigService,
          useValue: { jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' } },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });
```

(Add imports for SmsService/MasterService/RedisService at top of spec file.)

- [ ] **Step 4: Update AuthModule to import dependencies**

```typescript
// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WechatModule } from '../wechat/wechat.module';
import { UserModule } from '../user/user.module';
import { SmsModule } from '../sms/sms.module';
import { MasterModule } from '../master/master.module';
import { AppConfigService } from '../config/config.service';

@Module({
  imports: [
    WechatModule,
    UserModule,
    SmsModule,
    MasterModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwt.secret,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 5: Run tests (all pass)**

```bash
pnpm test src/auth/auth.service.spec.ts
```
Expected: All tests PASS (1 from original + 5 new = 6 total).

- [ ] **Step 6: Commit**

```bash
cd ..
git add backend/src/auth
git commit -m "$(cat <<'EOF'
feat(backend): add sendSmsCode + loginMasterPhone + bindMasterUnionid

Refs #4
EOF
)"
```

---

### Task 30: AuthController — SMS + master login endpoints

**Files:**
- Modify: `backend/src/auth/auth.controller.ts`

- [ ] **Step 1: Replace AuthController**

```typescript
// backend/src/auth/auth.controller.ts
import {
  Body,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginWechatDto } from './dto/login-wechat.dto';
import { SendSmsDto } from './dto/send-sms.dto';
import { LoginMasterPhoneDto } from './dto/login-master-phone.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';

interface AuthedRequest {
  user: AuthenticatedUser;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login/wechat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户微信登录 (wx.login → code → JWT)' })
  loginWechat(@Body() dto: LoginWechatDto) {
    return this.authService.loginWithWechat(dto.code);
  }

  @Post('sms/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送短信验证码 (师傅 H5 登录用)' })
  async sendSms(@Body() dto: SendSmsDto) {
    await this.authService.sendSmsCode(dto.phone);
    return { sent: true };
  }

  @Post('login/master')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '师傅手机号+验证码登录' })
  loginMaster(@Body() dto: LoginMasterPhoneDto) {
    return this.authService.loginMasterPhone(dto.phone, dto.code);
  }

  @Post('master/bind-unionid')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '师傅绑定微信 unionid (扫码后调用)' })
  bindUnionid(@Req() req: AuthedRequest, @Body() dto: LoginWechatDto) {
    return this.authService.bindMasterUnionid(req.user.id, dto.code);
  }
}
```

- [ ] **Step 2: Verify it boots**

```bash
cd backend && pnpm run start:dev
```
Open `http://localhost:3000/docs` → expect 4 endpoints under `auth` tag.
Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/auth/auth.controller.ts
git commit -m "$(cat <<'EOF'
feat(backend): add POST /auth/sms/send + login/master + master/bind-unionid

Refs #4
EOF
)"
```

---

### Task 31: E2E test for 师傅 phone login flow

**Files:**
- Create: `backend/test/e2e/auth-master.e2e-spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// backend/test/e2e/auth-master.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SmsService } from '../../src/sms/sms.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

describe('Master phone login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const sentCodes: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SmsService)
      .useValue({
        sendVerificationCode: jest.fn(async (phone: string, code: string) => {
          sentCodes[phone] = code;
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);

    await prisma.master.deleteMany({ where: { phone: '13900139001' } });
    await redis.del('sms:code:13900139001', 'sms:rate:13900139001');
  });

  afterAll(async () => {
    await prisma.master.deleteMany({ where: { phone: '13900139001' } });
    await redis.del('sms:code:13900139001', 'sms:rate:13900139001');
    await app.close();
  });

  it('full flow: send code → login → master record exists', async () => {
    // Send
    await request(app.getHttpServer())
      .post('/auth/sms/send')
      .send({ phone: '13900139001' })
      .expect(200);

    const code = sentCodes['13900139001'];
    expect(code).toMatch(/^\d{6}$/);

    // Login
    const loginResp = await request(app.getHttpServer())
      .post('/auth/login/master')
      .send({ phone: '13900139001', code })
      .expect(200);

    expect(loginResp.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      userId: expect.any(String),
    });

    const master = await prisma.master.findUnique({ where: { phone: '13900139001' } });
    expect(master?.status).toBe('PENDING');
  });

  it('rejects wrong code', async () => {
    await redis.set('sms:code:13900139001', '999999', 'EX', 300);
    await request(app.getHttpServer())
      .post('/auth/login/master')
      .send({ phone: '13900139001', code: '000000' })
      .expect(400);
  });

  it('rejects bad phone format', async () => {
    await request(app.getHttpServer())
      .post('/auth/sms/send')
      .send({ phone: '12345' })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
cd backend
pnpm exec jest --config ./test/jest-e2e.json --testPathPattern=auth-master
```
Expected: All 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/test/e2e/auth-master.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(backend): e2e for 师傅 sms send + phone login flow

Refs #4
EOF
)"
```

---

## Phase H — RBAC & Guards

### Task 32: @Roles decorator + RolesGuard

**Files:**
- Create: `backend/src/common/decorators/roles.decorator.ts`
- Create: `backend/src/common/decorators/current-user.decorator.ts`
- Create: `backend/src/common/decorators/public.decorator.ts`
- Create: `backend/src/common/guards/roles.guard.ts`

- [ ] **Step 1: Create decorators**

```typescript
// backend/src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '../../auth/auth.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// backend/src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

```typescript
// backend/src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 2: Create RolesGuard**

```typescript
// backend/src/common/guards/roles.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../../auth/auth.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Role ${user.role} not allowed`);
    }
    return true;
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/common
git commit -m "$(cat <<'EOF'
feat(backend): add @Roles/@Public/@CurrentUser decorators + RolesGuard

Refs #4
EOF
)"
```

---

### Task 33: Apply RBAC to a sample protected endpoint

**Files:**
- Create: `backend/src/auth/auth-test.controller.ts` (sample protected endpoints for E2E)

- [ ] **Step 1: Create AuthTestController (Swagger sample, also used by E2E)**

```typescript
// backend/src/auth/auth-test.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('auth-test')
@Controller('auth-test')
export class AuthTestController {
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  whoami(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, role: user.role };
  }

  @Get('admin-only')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  adminOnly() {
    return { secret: 'only admins see this' };
  }
}
```

- [ ] **Step 2: Wire controller into AuthModule**

In `backend/src/auth/auth.module.ts`, add to `controllers`:

```typescript
controllers: [AuthController, AuthTestController],
```

(Import `AuthTestController` at top.)

- [ ] **Step 3: Verify**

```bash
cd backend && pnpm run start:dev
```
Open `http://localhost:3000/docs` → expect `auth-test` tag with `GET /auth-test/me` and `GET /auth-test/admin-only` both showing a 🔒 lock icon.
Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/auth
git commit -m "$(cat <<'EOF'
feat(backend): add /auth-test endpoints to exercise RBAC

Refs #4
EOF
)"
```

---

### Task 34: E2E test for RBAC enforcement

**Files:**
- Create: `backend/test/e2e/rbac.e2e-spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// backend/test/e2e/rbac.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
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
```

- [ ] **Step 2: Run E2E**

```bash
cd backend
pnpm exec jest --config ./test/jest-e2e.json --testPathPattern=rbac
```
Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/test/e2e/rbac.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(backend): e2e for RBAC (USER vs ADMIN role enforcement)

Refs #4
EOF
)"
```

---

## Phase I — CI/CD & Docs

### Task 35: GitHub Actions workflow for backend

**Files:**
- Create: `.github/workflows/backend-ci.yml` (at repo root)

- [ ] **Step 1: Create workflow**

```yaml
# .github/workflows/backend-ci.yml
name: Backend CI

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - '.github/workflows/backend-ci.yml'
  pull_request:
    paths:
      - 'backend/**'
      - '.github/workflows/backend-ci.yml'

jobs:
  test:
    name: Lint + Test + Build
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root_password
          MYSQL_DATABASE: sougexianer_test
          MYSQL_USER: sougexianer
          MYSQL_PASSWORD: dev_password
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost -uroot -proot_password"
          --health-interval=10s --health-timeout=5s --health-retries=10
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd="redis-cli ping"
          --health-interval=10s --health-timeout=5s --health-retries=10

    defaults:
      run:
        working-directory: backend

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
          cache-dependency-path: backend/pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma Client
        run: pnpm exec prisma generate

      - name: Run migrations on test DB
        run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: "mysql://sougexianer:dev_password@127.0.0.1:3306/sougexianer_test"

      - name: Lint
        run: pnpm run lint

      - name: Unit tests
        run: pnpm test
        env:
          DATABASE_URL: "mysql://sougexianer:dev_password@127.0.0.1:3306/sougexianer_test"
          REDIS_HOST: 127.0.0.1
          REDIS_PORT: 6379
          REDIS_PASSWORD: ""
          JWT_SECRET: "test_secret_at_least_32_characters_long_xx"
          JWT_EXPIRES_IN: "7d"
          JWT_REFRESH_EXPIRES_IN: "30d"
          WECHAT_APPID: "wx_test"
          WECHAT_APPSECRET: "test_secret"
          TENCENT_SECRET_ID: "test_id"
          TENCENT_SECRET_KEY: "test_key"
          TENCENT_SMS_SDK_APP_ID: "1400000000"
          TENCENT_SMS_SIGN_NAME: "搜个仙儿"
          TENCENT_SMS_TEMPLATE_ID: "000000"
          CORS_ORIGIN: "http://localhost:3000"

      - name: E2E tests
        run: pnpm exec jest --config ./test/jest-e2e.json
        env:
          DATABASE_URL: "mysql://sougexianer:dev_password@127.0.0.1:3306/sougexianer_test"
          REDIS_HOST: 127.0.0.1
          REDIS_PORT: 6379
          REDIS_PASSWORD: ""
          JWT_SECRET: "test_secret_at_least_32_characters_long_xx"
          JWT_EXPIRES_IN: "7d"
          JWT_REFRESH_EXPIRES_IN: "30d"
          WECHAT_APPID: "wx_test"
          WECHAT_APPSECRET: "test_secret"
          TENCENT_SECRET_ID: "test_id"
          TENCENT_SECRET_KEY: "test_key"
          TENCENT_SMS_SDK_APP_ID: "1400000000"
          TENCENT_SMS_SIGN_NAME: "搜个仙儿"
          TENCENT_SMS_TEMPLATE_ID: "000000"
          CORS_ORIGIN: "http://localhost:3000"

      - name: Build
        run: pnpm run build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/backend-ci.yml
git commit -m "$(cat <<'EOF'
ci: add backend-ci workflow (lint/test/build with mysql+redis)

Refs #3
EOF
)"
```

---

### Task 36: Backend README

**Files:**
- Create: `backend/README.md`

- [ ] **Step 1: Create README**

```markdown
# 搜个仙儿 Backend

NestJS + TypeScript + Prisma + MySQL + Redis backend for 搜个仙儿 MVP.

## Architecture

See [docs/superpowers/specs/2026-05-18-sougexianer-design.md](../docs/superpowers/specs/2026-05-18-sougexianer-design.md) for the full design.

This service implements:
- **Auth**: 用户微信登录 (`/auth/login/wechat`) + 师傅 手机号登录 (`/auth/login/master`)
- **RBAC**: USER / MASTER / ADMIN roles via `@Roles()` decorator + `RolesGuard`
- **Data**: Full Prisma schema (User / Master / SKU / Order / Conversation / Message / Review / DisputeCase / etc.)
- **External**: 微信 `code2Session`, 腾讯云短信

Business modules (订单 / IM / 评价 / 仲裁 / 支付 / 合规 / 风控) added in Plans 2-5.

## Prerequisites

- Node.js 20 LTS
- pnpm 8+
- Docker + Docker Compose

## Quick Start

```bash
# 1. Start local MySQL + Redis
docker compose -f docker-compose.dev.yml up -d

# 2. Install deps
pnpm install

# 3. Copy env
cp .env.example .env
# Edit .env to fill in WECHAT_APPID, WECHAT_APPSECRET, TENCENT_* credentials

# 4. Run migrations
pnpm exec prisma migrate dev

# 5. Start dev server
pnpm run start:dev
```

API will be on `http://localhost:3000`, Swagger at `http://localhost:3000/docs`.

## Scripts

- `pnpm run start:dev` — Watch mode dev server
- `pnpm test` — Unit tests
- `pnpm exec jest --config ./test/jest-e2e.json` — E2E tests
- `pnpm run lint` — ESLint
- `pnpm run build` — Production build
- `pnpm exec prisma studio` — Visual DB inspector

## Project Structure

```
src/
├── main.ts              # Bootstrap
├── app.module.ts        # Root module
├── config/              # Typed env access
├── common/              # Filters, interceptors, guards, decorators
├── prisma/              # Global Prisma module
├── redis/               # Global Redis module
├── wechat/              # 微信 code2Session
├── sms/                 # 腾讯云短信
├── health/              # /health endpoint
├── auth/                # Auth (login, JWT, guards)
├── user/                # User entity service
└── master/              # Master entity service
```

## Architecture Principles

- **微信标准接口优先** (per spec §9.0): 登录 / 支付 / 订阅消息 / 内容审核 → 用 `wx.*` 官方 API
- **Module per business concept** (per spec §10): Each Prisma entity has its own NestJS module
- **Test what's tested** (TDD): Every service method has unit tests; every API endpoint has E2E

## Related Issues

- Epic: [#1 搜个仙儿 MVP V1](https://github.com/CharlieCXC/WechatMiniProgram/issues/1)
- This package implements: [#3 后端基础](https://github.com/CharlieCXC/WechatMiniProgram/issues/3) + [#4 鉴权系统](https://github.com/CharlieCXC/WechatMiniProgram/issues/4)
```

- [ ] **Step 2: Commit**

```bash
git add backend/README.md
git commit -m "$(cat <<'EOF'
docs(backend): add README with setup + architecture overview

Refs #3
EOF
)"
```

---

### Task 37: Final smoke test — full flow end-to-end

**Files:** (no new files; verify the whole stack works)

- [ ] **Step 1: Ensure docker services are up**

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
```

- [ ] **Step 2: Run all unit tests**

```bash
pnpm test
```
Expected: All unit tests pass.

- [ ] **Step 3: Run all E2E tests**

```bash
pnpm exec jest --config ./test/jest-e2e.json
```
Expected: All E2E tests pass.

- [ ] **Step 4: Boot server**

```bash
pnpm run start:dev
```

- [ ] **Step 5: Manual smoke test**

In another terminal:
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/auth/sms/send \
  -H 'Content-Type: application/json' \
  -d '{"phone": "13800138000"}'
```

(Note: the SMS will actually try to send via Tencent unless you've overridden the SmsService for manual testing — this will fail with a Tencent error message, which is expected for placeholder credentials.)

Verify:
- `/health` returns `{"success":true,"data":{"status":"ok","mysql":"ok","redis":"ok"}}`
- `/auth/sms/send` returns 400 with Tencent SDK error (proves the wiring works end-to-end up to the SDK call)

Ctrl+C to stop.

- [ ] **Step 6: No code change needed**

This task is verification-only. No commit unless smoke surfaces an issue requiring a code fix.

---

### Task 38: PR to merge backend foundation

**Files:** (none — git operations only)

- [ ] **Step 1: Check current branch**

```bash
cd ..  # back to repo root
git branch --show-current
```

If the work was done on `main` directly (since these are the first backend commits), create a branch retroactively:

```bash
# If branch is already 'main' but commits are mixed:
# 1. Find the commit before backend started (= the spec PR's merge commit, OR initial commit if spec wasn't merged yet)
# 2. Move them to a feature branch.
# Simpler: do this work on a feature branch from the start (recommended).

# If you didn't, do this:
git checkout -b feat/backend-foundation
git push -u origin feat/backend-foundation
```

If you DID work on a feature branch (e.g., `feat/backend-foundation`), push and PR:

```bash
git push -u origin feat/backend-foundation
gh pr create --title "feat(backend): foundation layer (Plan 1)" --body "$(cat <<'EOF'
## 变更说明

实现 Plan 1 Foundation Layer：完整 NestJS 后端骨架 + Prisma 全数据模型 + 用户微信登录 + 师傅手机号登录 + JWT/RBAC。

完成 [Plan 1 文档](docs/superpowers/plans/2026-05-19-plan-1-foundation.md) 中全部 37 个任务。

## 关联

- Resolves #3 (后端基础)
- Resolves #4 (鉴权系统)
- Refs #1 (Epic)

## 影响范围

- 新增 `backend/` 目录（完整 NestJS 项目）
- 新增 `.github/workflows/backend-ci.yml`
- 不影响 `pages/` (小程序) 或其他既有目录

## 测试结果

- ✅ 所有 unit tests 通过 (`pnpm test`)
- ✅ 所有 E2E tests 通过 (`pnpm exec jest --config ./test/jest-e2e.json`)
- ✅ Lint 通过 (`pnpm run lint`)
- ✅ Build 通过 (`pnpm run build`)
- ✅ 手工验证 /health 返回 ok，Swagger 在 /docs 可见

## 检查清单

- [x] Plan 1 全部 37 任务完成
- [x] CI workflow 已添加
- [x] README 已添加
- [x] 所有 commit 符合 type(scope): description 格式
- [x] 单文件均 ≤500 行
EOF
)"
```

- [ ] **Step 2: After PR approved + merged, close issues #3 and #4 via PR merge keyword**

(The "Resolves #3 / Resolves #4" in PR body will auto-close on merge.)

- [ ] **Step 3: Update Epic #1 checklist**

```bash
gh issue view 1 --json body --jq '.body' | \
  sed 's|- \[ \] F1 - 后端基础|- [x] F1 - 后端基础|; s|- \[ \] F2 - 鉴权系统|- [x] F2 - 鉴权系统|' | \
  gh issue edit 1 --body-file -
```

Verify: `gh issue view 1` shows F1 and F2 checked off.

---

## Self-Review

### 1. Spec coverage check

Against spec § 5 (核心模块) and §9 (技术栈):
- ✅ §5.1 师傅 system (data model only; CRUD endpoints in Plan 2)
- ✅ §6 数据模型 (full Prisma schema for ALL Plan 1-5 entities)
- ✅ §9.1 技术栈 各层选型 (NestJS / Prisma / MySQL / Redis 全部实现)
- ✅ §9.0 架构原则 微信标准接口优先 (wechat.code2Session used directly)
- ✅ §11.4 服务器域名白名单 (规划在 .env.example 注释中提到)

Gaps intentionally left for Plan 2-5:
- 师傅 Profile CRUD endpoints (Plan 2)
- Service SKU CRUD (Plan 2)
- Order endpoints (Plan 3)
- IM endpoints (Plan 3)
- Payment integration (Plan 3)
- Review/Dispute endpoints (Plan 4)
- Compliance + risk implementation (Plan 5)

### 2. Placeholder scan

Searched plan for: TBD, TODO, "implement later", "add appropriate", "similar to Task". None found.

### 3. Type consistency

Cross-check:
- `Role` type defined in `auth.service.ts` and reused in `roles.decorator.ts`, `jwt.strategy.ts` ✅
- `AuthenticatedUser` defined in `jwt.strategy.ts` and reused in `auth.controller.ts` (`AuthedRequest.user`) and `roles.guard.ts` ✅
- `JwtPayload` defined in `auth.service.ts` and used in `jwt.strategy.ts` ✅
- `LoginResult` defined in `auth.service.ts`, returned by both `loginWithWechat` and `loginMasterPhone` ✅
- Prisma enum `MasterStatus.PENDING` used consistently in `MasterService.findOrCreateByPhone` ✅
- Prisma model field `unrespondedCount` (not `pendingCount` or `freeMessagesUsed`) consistent for future Plan 3 IM work ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-plan-1-foundation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for catching issues early.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Best for tight feedback loop with you.

**Which approach?**

---

## Out-of-Scope (Plan 2-5 Roadmap Reminder)

After Plan 1 ships, return to brainstorming-style writing-plans for:
- **Plan 2**: 师傅 H5 后台 + 入驻流程 (Issues #5 + #6)
- **Plan 3**: 订单 + IM + 支付 (Issues #9 + #10 + #12)
- **Plan 4**: 小程序 + 评价 + 仲裁 (Issues #7 + #8 + #11)
- **Plan 5**: 合规 + 风控 + 首审 (Issues #13 + #14)
