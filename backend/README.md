# 搜个仙儿 Backend

NestJS + TypeScript + Prisma + MySQL + Redis backend for 搜个仙儿 MVP.

## Architecture

See [docs/superpowers/specs/2026-05-18-sougexianer-design.md](../docs/superpowers/specs/2026-05-18-sougexianer-design.md) for the full design.

This service implements (Plan 1 Foundation):
- **Auth**: 用户微信登录 (`POST /auth/login/wechat`) + 师傅 手机号登录 (`POST /auth/sms/send` + `POST /auth/login/master`)
- **RBAC**: USER / MASTER / ADMIN roles via `@Roles()` decorator + `RolesGuard`
- **Data**: Full Prisma schema (User / Master / SKU / Order / Conversation / Message / Review / DisputeCase / Asset / Schedule / Settlement / Favorite)
- **External**: 微信 `code2Session`, 腾讯云短信
- **Infra**: Global Prisma + Redis modules, exception filter, response interceptor, `/health`, Swagger at `/docs`

Business modules (订单 / IM / 评价 / 仲裁 / 支付 / 合规 / 风控) are added in Plans 2-5.

## Prerequisites

- Node.js 20 LTS
- pnpm 8+
- Docker + Docker Compose

## Quick Start

```bash
# 1. Start local MySQL + Redis (MySQL host port is 3307 to avoid conflict with Homebrew MySQL)
docker compose -f docker-compose.dev.yml up -d

# 2. Install deps
pnpm install

# 3. Copy env
cp .env.example .env
# Edit .env: fill in WECHAT_APPID/APPSECRET, TENCENT_* credentials

# 4. Run migrations
pnpm exec prisma migrate dev

# 5. Start dev server
pnpm run start:dev
```

API on `http://localhost:3000`, Swagger at `http://localhost:3000/docs`.

## Scripts

- `pnpm run start:dev` — Watch-mode dev server
- `pnpm test` — Unit tests
- `pnpm exec jest --config ./test/jest-e2e.json` — E2E tests (needs MySQL+Redis)
- `pnpm run lint` — ESLint
- `pnpm run build` — Production build
- `pnpm exec prisma studio` — Visual DB inspector

## Architecture Principles

- **微信标准接口优先** (per spec §9.0): 登录 / 支付 / 订阅消息 / 内容审核 → use `wx.*` official APIs
- **Module per business concept**: each Prisma entity gets its own NestJS module
- **TDD**: every service method has unit tests; every API endpoint has E2E

## Notes

- **MySQL host port is 3307** (not 3306) because a Homebrew MySQL occupies 3306 on the dev machine. Inside Docker the container still listens on 3306. CI uses 3306 directly.
- pnpm v11 requires build approval for packages with postinstall scripts (`@prisma/client`, `@nestjs/core`); approvals are recorded in `pnpm-workspace.yaml`.

## Related Issues

- Epic: [#1 搜个仙儿 MVP V1](https://github.com/CharlieCXC/WechatMiniProgram/issues/1)
- This package implements: [#3 后端基础](https://github.com/CharlieCXC/WechatMiniProgram/issues/3) + [#4 鉴权系统](https://github.com/CharlieCXC/WechatMiniProgram/issues/4)
