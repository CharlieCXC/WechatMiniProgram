# 订单系统 + 异步交付（后端）Implementation Plan — Plan 3a

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已落地的 master 供给端之上，搭建「订单状态机 + 异步报告交付 + 改价 + 延期」的完整后端闭环。微信支付/腾讯云 TIM/腾讯云 COS 均以 service-boundary stub 实现，留待 Plan 3c（支付）/ Plan 3b（实时 IM）做真集成。

**Architecture:** 新增 `OrderModule`（订单领域 service/controller 集合）+ `ConversationModule`（IM 会话最小落库层，3b 会扩展 TIM 推送）+ `PaymentModule`（WechatPayService stub + notify 入口）。订单 = 单向状态机，每次状态变更同时往 `Conversation/Message` 表写一张 SYSTEM_CARD 卡片（不推送，留作记录 + 3b 推送时补发）。所有金额单位「分」。

**Tech Stack:** Node 22 + NestJS 10 + TypeScript + Prisma 6（MySQL 8）+ Redis 7 + Jest + supertest + pnpm 11.1.3。

---

## Conventions（必读）

- **金额单位**：全部 `Int` 表示「分」。`originalPrice/finalPrice/platformFee/sku.price` 同一单位。
- **平台佣金率**：固定 10% `platformFee = Math.floor(finalPrice * 0.1)`。Order 创建 + 改价接受 时都重新计算并落库。
- **响应包络**：`ResponseInterceptor` 全局包 `{ data }`，e2e 读 `resp.body.data`。
- **鉴权**：
  - 用户端口（小程序）：`@Roles('USER')`，token sub = user.id。
  - 师傅端口（H5 后台）：`@Roles('MASTER')`，token sub = master.id。
  - 支付回调：无鉴权（仿真微信侧 POST），靠 `WechatPayService.verifyNotify(body)` 桩验签。
- **Prisma 错误**：`P2025`→`NotFoundException`(404)，`P2002`→`ConflictException`(409)。
- **存量代码不动**：本计划不修改 Plan 2 任何代码，只追加新模块（除 schema 必须扩展 `Order`、新增 `ExtensionRequest`）。
- **stubs 等同 Plan 1**：`WechatPayService` 类似 `WechatService`/`SmsService` 的实现——签名清晰、行为可预测、单测里直接 mock、e2e 用 `overrideProvider`。
- **测试环境**：`export PATH="$HOME/Library/pnpm/bin:$PATH"`；docker mysql:3307 / redis:6379 已 healthy；`backend/.env` 完整。Run from `backend/`.
- **commit-msg hook**：commitlint header ≤72，小写 subject，types 限 feat/fix/refactor/test/docs/chore/ci/style。**绝不**用 `--no-verify`；hook 拒后改文案做新 commit（永远别 amend）。

---

## 状态机（权威定义）

```
PENDING_ACCEPT
  ├── master.accept    → ACCEPTED
  ├── master.reject    → CANCELLED
  └── user.cancel      → CANCELLED

ACCEPTED                                       (师傅已接，等用户付款)
  ├── user.requestPayment → PENDING_PAYMENT
  └── user.cancel        → CANCELLED

PENDING_PAYMENT
  ├── payment.notify(SUCCESS) → PAID → IN_PROGRESS  (auto, 设 deliveryDeadline)
  └── user.cancel             → CANCELLED

IN_PROGRESS                                   (师傅工作中)
  ├── master.deliver(artifactUrl,desc) → DELIVERED  (落 Asset 行)
  ├── master.proposePriceChange        → 留在 IN_PROGRESS，PriceChange row PENDING
  ├── master.requestExtension          → 留在 IN_PROGRESS，ExtensionRequest row PENDING
  └── user.cancel                      → REFUNDED   (3a 只转状态；真退款 3c)

DELIVERED
  ├── user.confirmDelivery → COMPLETED
  └── user.dispute         → IN_DISPUTE  (落 DisputeCase row；裁决归 Plan 4)

COMPLETED      —— terminal
IN_DISPUTE     —— terminal in 3a
CANCELLED      —— terminal
REFUNDED       —— terminal in 3a (Plan 3c 触发真退款)
```

**额外约束**：

- `requestPayment` 只在 `ACCEPTED` 允许。
- `proposePriceChange` 允许的源状态：`ACCEPTED / PENDING_PAYMENT / PAID / IN_PROGRESS`；`DELIVERED` 之后锁死。
- `respondPriceChange` 接受时：若 `newPrice > finalPrice`（需用户补差）但 3a 不做差额计算 —— 一律生效新价、`platformFee` 重算；真实差额收付留给 Plan 3c。
- `requestExtension` 仅 `IN_PROGRESS` 允许。`respondExtension` 接受时把 `Order.deliveryDeadline += additionalHours`。
- `user.cancel` 在 `PAID/IN_PROGRESS` 转 `REFUNDED`；之前的所有状态转 `CANCELLED`。
- 任一状态变更（含改价/延期 propose 与 respond）都向 Conversation 写一张 SYSTEM_CARD（无 push）。

---

## SYSTEM_CARD payload schema（统一在 ConversationService 落库）

`Message.systemCardData Json` 按 type 区分子结构：

| type | payload 字段 |
|---|---|
| `ORDER_CREATED` | `{ orderId, skuName, finalPrice }` |
| `ORDER_ACCEPTED` | `{ orderId }` |
| `ORDER_REJECTED` | `{ orderId, reason? }` |
| `ORDER_CANCELLED` | `{ orderId, by: 'USER'\|'MASTER' }` |
| `ORDER_PAID` | `{ orderId, paidAmount }` |
| `ORDER_DELIVERED` | `{ orderId, assetId, description }` |
| `ORDER_COMPLETED` | `{ orderId }` |
| `ORDER_DISPUTED` | `{ orderId, disputeId }` |
| `PRICE_CHANGE_REQUEST` | `{ orderId, priceChangeId, fromPrice, toPrice, reason }` |
| `PRICE_CHANGE_DECIDED` | `{ orderId, priceChangeId, decision: 'ACCEPTED'\|'REJECTED' }` |
| `EXTENSION_REQUEST` | `{ orderId, extensionId, additionalHours, reason }` |
| `EXTENSION_DECIDED` | `{ orderId, extensionId, decision: 'ACCEPTED'\|'REJECTED' }` |

`type` 存在 `Message.content` 字段（VARCHAR 文本），payload 在 `Message.systemCardData`。`senderType: SYSTEM`，`senderId: 'system'`（占位字符串，无 User/Master 关联）。`relatedOrderId` 填 orderId。

---

## File Structure

```
backend/prisma/schema.prisma                      # 修改：Order +deliveryDeadline；+ExtensionRequest 模型 +ExtensionStatus 枚举
backend/prisma/migrations/<ts>_orders_delivery/   # 新增迁移

backend/src/payment/
  payment.module.ts             # 新增
  wechat-pay.service.ts         # 新增：createPaymentIntent / verifyNotify (stub)
  wechat-pay.service.spec.ts    # 新增
  payment-notify.controller.ts  # 新增：POST /payments/wechat/notify (无鉴权)
  dto/wechat-pay-notify.dto.ts  # 新增

backend/src/conversation/
  conversation.module.ts        # 新增
  conversation.service.ts       # 新增：findOrCreate + addSystemCard
  conversation.service.spec.ts  # 新增

backend/src/order/
  order.module.ts                       # 新增：聚合所有 order 相关 controller/service
  order.service.ts                      # 新增：状态机核心
  order.service.spec.ts                 # 新增
  price-change.service.ts               # 新增：propose / respond
  price-change.service.spec.ts          # 新增
  extension.service.ts                  # 新增：propose / respond
  extension.service.spec.ts             # 新增
  order.controller.ts                   # 新增：USER 端口
  master-order.controller.ts            # 新增：MASTER 端口
  price-change.controller.ts            # 新增：MASTER propose + USER respond
  extension.controller.ts               # 新增：MASTER propose + USER respond
  dto/
    create-order.dto.ts
    reject-order.dto.ts
    deliver-order.dto.ts
    dispute-order.dto.ts
    propose-price-change.dto.ts
    respond-price-change.dto.ts
    propose-extension.dto.ts
    respond-extension.dto.ts

backend/src/app.module.ts        # 修改：imports += PaymentModule, ConversationModule, OrderModule

backend/test/e2e/
  order-lifecycle.e2e-spec.ts   # 创建→接单→付款→交付→确认 完整链路
  order-cancel.e2e-spec.ts      # 各状态取消分流
  price-change.e2e-spec.ts      # 改价 propose/accept/reject
  extension.e2e-spec.ts         # 延期 propose/accept/reject
  order-dispute.e2e-spec.ts     # 异议
  order-rbac.e2e-spec.ts        # IDOR / 跨主体防御
```

---

### Task 1: Schema — Order.deliveryDeadline + ExtensionRequest + ExtensionStatus + 迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<ts>_orders_delivery/migration.sql`（prisma 生成）

- [ ] **Step 1: 修改 schema.prisma — Order 增字段 deliveryDeadline**

在 `model Order { ... }` 内，紧接 `scheduledAt DateTime?` 之后增加：

```prisma
  deliveryDeadline DateTime?
```

- [ ] **Step 2: 修改 schema.prisma — 新增 ExtensionRequest 模型与枚举**

在 `enum PriceChangeStatus { ... }` 之后新增：

```prisma
model ExtensionRequest {
  id                String                 @id @default(cuid())
  orderId           String
  additionalHours   Int
  reason            String                 @db.Text
  status            ExtensionRequestStatus @default(PENDING)
  decidedAt         DateTime?
  createdAt         DateTime               @default(now())

  @@index([orderId])
  @@map("extension_requests")
}

enum ExtensionRequestStatus {
  PENDING
  ACCEPTED
  REJECTED
}
```

- [ ] **Step 3: 生成迁移**

```bash
export PATH="$HOME/Library/pnpm/bin:$PATH" && cd backend
pnpm exec prisma migrate dev --name orders_delivery
```
Expected: `Your database is now in sync with your schema.`，Prisma Client 自动重生成。

- [ ] **Step 4: 类型校验**

```bash
pnpm exec prisma generate && pnpm exec tsc --noEmit
```
Expected: 无错误，`ExtensionRequest` / `ExtensionRequestStatus` 进入 `@prisma/client`。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(backend): add order delivery deadline + extension request

Refs #9"
```

---

### Task 2: WechatPayService — stub 实现 + 单测

**Files:**
- Create: `backend/src/payment/wechat-pay.service.ts`
- Test: `backend/src/payment/wechat-pay.service.spec.ts`

> 接口设计**与 Plan 3c 真实实现保持一致**，3c 只换内部即可，外部签名不变。`createPaymentIntent` 返回 stub 的 prepayId；`verifyNotify` 是签名校验入口（stub 一律 true）；`buildNotifyTradeNo(orderId)` 形成可逆的 out_trade_no（stub 用 `STUB_<orderId>` 前缀）。

- [ ] **Step 1: 失败测试** `backend/src/payment/wechat-pay.service.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { WechatPayService } from './wechat-pay.service';

describe('WechatPayService (stub)', () => {
  let service: WechatPayService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [WechatPayService],
    }).compile();
    service = moduleRef.get(WechatPayService);
  });

  it('createPaymentIntent returns deterministic stub prepay params', async () => {
    const result = await service.createPaymentIntent({
      orderId: 'o1',
      amount: 9900,
      openid: 'wx_oid',
      description: '测试订单',
    });
    expect(result).toMatchObject({
      prepayId: expect.stringMatching(/^STUB_PREPAY_o1$/),
      outTradeNo: expect.stringMatching(/^STUB_o1$/),
    });
    expect(typeof result.signTimestamp).toBe('string');
  });

  it('verifyNotify returns true for any non-empty body in stub mode', () => {
    expect(service.verifyNotify({ outTradeNo: 'STUB_o1' })).toBe(true);
    expect(service.verifyNotify({})).toBe(false);
  });

  it('parseOrderIdFromTradeNo extracts orderId from stub trade no', () => {
    expect(service.parseOrderIdFromTradeNo('STUB_abc123')).toBe('abc123');
  });

  it('parseOrderIdFromTradeNo returns null for foreign formats', () => {
    expect(service.parseOrderIdFromTradeNo('1234567890')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- wechat-pay.service` → FAIL（模块不存在）。

- [ ] **Step 3: 实现** `backend/src/payment/wechat-pay.service.ts`

```typescript
import { Injectable } from '@nestjs/common';

export interface CreatePaymentIntentInput {
  orderId: string;
  amount: number; // 分
  openid: string;
  description: string;
}

export interface PaymentIntent {
  prepayId: string;
  outTradeNo: string;
  signTimestamp: string;
}

export interface NotifyBody {
  outTradeNo?: string;
}

@Injectable()
export class WechatPayService {
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    return {
      prepayId: `STUB_PREPAY_${input.orderId}`,
      outTradeNo: `STUB_${input.orderId}`,
      signTimestamp: String(Math.floor(Date.now() / 1000)),
    };
  }

  verifyNotify(body: NotifyBody): boolean {
    return !!body.outTradeNo;
  }

  parseOrderIdFromTradeNo(outTradeNo: string): string | null {
    const m = outTradeNo.match(/^STUB_(.+)$/);
    return m ? m[1] : null;
  }
}
```

- [ ] **Step 4: 跑通过**: `pnpm test -- wechat-pay.service` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/payment/wechat-pay.service.ts src/payment/wechat-pay.service.spec.ts
git commit -m "feat(backend): add WechatPayService stub

Refs #9 #12"
```

---

### Task 3: ConversationService — findOrCreate + addSystemCard + 单测

**Files:**
- Create: `backend/src/conversation/conversation.service.ts`
- Test: `backend/src/conversation/conversation.service.spec.ts`

> 这是 3b（IM）会接续扩展的最小落库层：会话与系统卡片只写 DB，不推 TIM。所有 SYSTEM_CARD 都通过这个方法落，3b 再补 TIM push。

- [ ] **Step 1: 失败测试**

```typescript
import { Test } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: {
    conversation: { findUnique: jest.Mock; create: jest.Mock };
    message: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      conversation: { findUnique: jest.fn(), create: jest.fn() },
      message: { create: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ConversationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ConversationService);
  });

  describe('findOrCreate', () => {
    it('returns existing conversation when present', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1' });
      const result = await service.findOrCreate('u1', 'm1');
      expect(result).toEqual({ id: 'c1' });
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a conversation when missing', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'c2', userId: 'u1', masterId: 'm1' });
      const result = await service.findOrCreate('u1', 'm1');
      expect(result.id).toBe('c2');
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { userId: 'u1', masterId: 'm1' },
      });
    });
  });

  describe('addSystemCard', () => {
    it('persists a SYSTEM/SYSTEM_CARD message with payload and orderId', async () => {
      prisma.message.create.mockResolvedValue({ id: 'msg1' });
      const r = await service.addSystemCard({
        conversationId: 'c1',
        cardType: 'ORDER_CREATED',
        payload: { orderId: 'o1', skuName: 'x', finalPrice: 9900 },
        orderId: 'o1',
      });
      expect(r.id).toBe('msg1');
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          senderId: 'system',
          senderType: 'SYSTEM',
          type: 'SYSTEM_CARD',
          content: 'ORDER_CREATED',
          systemCardData: { orderId: 'o1', skuName: 'x', finalPrice: 9900 },
          relatedOrderId: 'o1',
          auditStatus: 'PASS',
        },
      });
    });
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- conversation.service` → FAIL.

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Conversation, Message } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SystemCardType =
  | 'ORDER_CREATED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'ORDER_PAID'
  | 'ORDER_DELIVERED'
  | 'ORDER_COMPLETED'
  | 'ORDER_DISPUTED'
  | 'PRICE_CHANGE_REQUEST'
  | 'PRICE_CHANGE_DECIDED'
  | 'EXTENSION_REQUEST'
  | 'EXTENSION_DECIDED';

export interface AddSystemCardInput {
  conversationId: string;
  cardType: SystemCardType;
  payload: Record<string, unknown>;
  orderId: string;
}

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(userId: string, masterId: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: { userId_masterId: { userId, masterId } },
    });
    if (existing) return existing;
    return this.prisma.conversation.create({ data: { userId, masterId } });
  }

  async addSystemCard(input: AddSystemCardInput): Promise<Message> {
    return this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: 'system',
        senderType: 'SYSTEM',
        type: 'SYSTEM_CARD',
        content: input.cardType,
        systemCardData: input.payload as Record<string, unknown>,
        relatedOrderId: input.orderId,
        auditStatus: 'PASS',
      },
    });
  }
}
```

> 注：`Conversation` 上有 `@@unique([userId, masterId])`，所以 `findUnique({ where: { userId_masterId: { userId, masterId } } })` 是 Prisma 生成的复合唯一查询签名。

- [ ] **Step 4: 跑通过**: `pnpm test -- conversation.service` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/conversation/conversation.service.ts src/conversation/conversation.service.spec.ts
git commit -m "feat(backend): add ConversationService (findOrCreate + system card)

Refs #9 #10"
```

---

### Task 4: PaymentModule + ConversationModule + AppModule 接入

**Files:**
- Create: `backend/src/payment/payment.module.ts`
- Create: `backend/src/conversation/conversation.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: PaymentModule** `backend/src/payment/payment.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.service';

@Module({
  providers: [WechatPayService],
  exports: [WechatPayService],
})
export class PaymentModule {}
```

- [ ] **Step 2: ConversationModule** `backend/src/conversation/conversation.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';

@Module({
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
```

- [ ] **Step 3: AppModule import** — 修改 `backend/src/app.module.ts` 加 imports（不动既有顺序，在 `AdminModule` 之后追加）：

```typescript
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MasterModule } from './master/master.module';
import { AdminModule } from './admin/admin.module';
import { PaymentModule } from './payment/payment.module';
import { ConversationModule } from './conversation/conversation.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    MasterModule,
    AdminModule,
    PaymentModule,
    ConversationModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: 确认构建通过**

```bash
pnpm build 2>&1 | tail -5
```
Expected: `nest build` 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/payment/payment.module.ts src/conversation/conversation.module.ts src/app.module.ts
git commit -m "chore(backend): wire PaymentModule + ConversationModule

Refs #9 #12"
```

---

### Task 5: OrderService（核心一）— create / accept / reject + 单测

**Files:**
- Create: `backend/src/order/order.service.ts`
- Test: `backend/src/order/order.service.spec.ts`

> 此任务只覆盖 `createOrder / acceptOrder / rejectOrder` 三个方法。`cancelOrder` 在 Task 6，支付相关在 Task 7，交付/确认/异议在 Task 8。每次方法补完都跑测试 + commit。

- [ ] **Step 1: 失败测试** `backend/src/order/order.service.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('OrderService — create/accept/reject', () => {
  let service: OrderService;
  let prisma: {
    serviceSKU: { findUnique: jest.Mock };
    master: { findUnique: jest.Mock };
    order: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: {
    findOrCreate: jest.Mock;
    addSystemCard: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      serviceSKU: { findUnique: jest.fn() },
      master: { findUnique: jest.fn() },
      order: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    conv = {
      findOrCreate: jest.fn(),
      addSystemCard: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('createOrder', () => {
    it('creates an order in PENDING_ACCEPT with 10% platform fee and a system card', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', name: '八字解读', price: 9900,
        status: 'ACTIVE', type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1', status: 'ACTIVE', onboardingStep: 'LIVE',
      });
      conv.findOrCreate.mockResolvedValue({ id: 'c1' });
      prisma.order.create.mockImplementation(async ({ data }) => ({ id: 'o1', ...data }));

      const order = await service.createOrder('u1', 'sku1');
      expect(order.id).toBe('o1');
      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          masterId: 'm1',
          skuId: 'sku1',
          skuSnapshot: expect.objectContaining({ id: 'sku1', price: 9900 }),
          state: 'PENDING_ACCEPT',
          conversationId: 'c1',
          originalPrice: 9900,
          finalPrice: 9900,
          platformFee: 990,
        },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_CREATED',
          orderId: 'o1',
          conversationId: 'c1',
          payload: expect.objectContaining({ orderId: 'o1', skuName: '八字解读', finalPrice: 9900 }),
        }),
      );
    });

    it('rejects creating an order against a DISABLED sku', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', price: 9900, status: 'DISABLED',
        type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      await expect(service.createOrder('u1', 'sku1')).rejects.toThrow(BadRequestException);
    });

    it('rejects creating an order against a non-ACTIVE master', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue({
        id: 'sku1', masterId: 'm1', price: 9900, status: 'ACTIVE',
        type: 'ASYNC_REPORT', deliveryHour: 48,
      });
      prisma.master.findUnique.mockResolvedValue({
        id: 'm1', status: 'PENDING', onboardingStep: 'INVITED',
      });
      await expect(service.createOrder('u1', 'sku1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when sku missing', async () => {
      prisma.serviceSKU.findUnique.mockResolvedValue(null);
      await expect(service.createOrder('u1', 'sku_nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptOrder', () => {
    it('transitions PENDING_ACCEPT → ACCEPTED with system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'PENDING_ACCEPT', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'ACCEPTED' });
      const result = await service.acceptOrder('m1', 'o1');
      expect(result.state).toBe('ACCEPTED');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'ACCEPTED', acceptedAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'ORDER_ACCEPTED', orderId: 'o1' }),
      );
    });

    it('throws NotFound when order missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.acceptOrder('m1', 'x')).rejects.toThrow(NotFoundException);
    });

    it('rejects when caller is not the order master (IDOR)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'PENDING_ACCEPT',
      });
      await expect(service.acceptOrder('m1', 'o1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when order state is not PENDING_ACCEPT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(service.acceptOrder('m1', 'o1')).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectOrder', () => {
    it('transitions PENDING_ACCEPT → CANCELLED with reason in system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'PENDING_ACCEPT', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'CANCELLED' });
      const result = await service.rejectOrder('m1', 'o1', '日程不便');
      expect(result.state).toBe('CANCELLED');
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_REJECTED',
          orderId: 'o1',
          payload: expect.objectContaining({ orderId: 'o1', reason: '日程不便' }),
        }),
      );
    });

    it('rejects when state is not PENDING_ACCEPT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(service.rejectOrder('m1', 'o1', 'x')).rejects.toThrow(ConflictException);
    });
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- order.service` → FAIL（无模块）。

- [ ] **Step 3: 实现** `backend/src/order/order.service.ts`

```typescript
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Order } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

const PLATFORM_FEE_RATE = 0.1;

function computePlatformFee(finalPrice: number): number {
  return Math.floor(finalPrice * PLATFORM_FEE_RATE);
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async createOrder(userId: string, skuId: string): Promise<Order> {
    const sku = await this.prisma.serviceSKU.findUnique({ where: { id: skuId } });
    if (!sku) throw new NotFoundException('SKU 不存在');
    if (sku.status !== 'ACTIVE') {
      throw new BadRequestException('SKU 已下架');
    }
    const master = await this.prisma.master.findUnique({ where: { id: sku.masterId } });
    if (!master || master.status !== 'ACTIVE') {
      throw new BadRequestException('师傅未上架');
    }

    const conv = await this.conversation.findOrCreate(userId, sku.masterId);
    const finalPrice = sku.price;
    const platformFee = computePlatformFee(finalPrice);
    const order = await this.prisma.order.create({
      data: {
        userId,
        masterId: sku.masterId,
        skuId: sku.id,
        skuSnapshot: sku as unknown as Record<string, unknown>,
        state: 'PENDING_ACCEPT',
        conversationId: conv.id,
        originalPrice: sku.price,
        finalPrice,
        platformFee,
      },
    });
    await this.conversation.addSystemCard({
      conversationId: conv.id,
      cardType: 'ORDER_CREATED',
      payload: { orderId: order.id, skuName: sku.name, finalPrice },
      orderId: order.id,
    });
    return order;
  }

  private async getOrderOwnedByMasterOrThrow(masterId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  async acceptOrder(masterId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'PENDING_ACCEPT') {
      throw new ConflictException('订单状态不允许接单');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'ACCEPTED', acceptedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_ACCEPTED',
      payload: { orderId },
      orderId,
    });
    return updated;
  }

  async rejectOrder(masterId: string, orderId: string, reason: string): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'PENDING_ACCEPT') {
      throw new ConflictException('订单状态不允许拒单');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'CANCELLED' },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_REJECTED',
      payload: { orderId, reason },
      orderId,
    });
    return updated;
  }
}
```

- [ ] **Step 4: 跑通过**: `pnpm test -- order.service` → 11 passed（create×4 + accept×4 + reject×2 + 共享 setup OK = 10? 数一下：create 4 cases, accept 4 cases, reject 2 cases = 10 tests）。Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/order/order.service.ts src/order/order.service.spec.ts
git commit -m "feat(backend): order create/accept/reject with state guards

Refs #9"
```

---

### Task 6: OrderService — cancelOrder + 单测

**Files:**
- Modify: `backend/src/order/order.service.ts`
- Modify: `backend/src/order/order.service.spec.ts`

`cancelOrder` 必须正确判断当前状态决定终态：
- PENDING_ACCEPT / ACCEPTED / PENDING_PAYMENT → 终态 CANCELLED
- PAID / IN_PROGRESS → 终态 REFUNDED
- 其他状态 → ConflictException

- [ ] **Step 1: 在 spec 末尾追加新 describe**（保留前面已有的 describe）

```typescript
describe('OrderService — cancel', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = { order: { findUnique: jest.fn(), update: jest.fn() } };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  it.each([
    ['PENDING_ACCEPT', 'CANCELLED'],
    ['ACCEPTED', 'CANCELLED'],
    ['PENDING_PAYMENT', 'CANCELLED'],
    ['PAID', 'REFUNDED'],
    ['IN_PROGRESS', 'REFUNDED'],
  ])('cancel from %s → %s', async (from, to) => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', userId: 'u1', state: from, conversationId: 'c1',
    });
    prisma.order.update.mockResolvedValue({ id: 'o1', state: to });
    const result = await service.cancelOrder('u1', 'o1');
    expect(result.state).toBe(to);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { state: to },
    });
    expect(conv.addSystemCard).toHaveBeenCalledWith(
      expect.objectContaining({
        cardType: 'ORDER_CANCELLED',
        payload: { orderId: 'o1', by: 'USER' },
      }),
    );
  });

  it('throws NotFound when order missing', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.cancelOrder('u1', 'x')).rejects.toThrow(NotFoundException);
  });

  it('rejects IDOR (user does not own the order)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', userId: 'u_other', state: 'PENDING_ACCEPT',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(NotFoundException);
  });

  it('rejects from DELIVERED state', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
    });
    await expect(service.cancelOrder('u1', 'o1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- order.service` → FAIL（cancelOrder 不存在）。

- [ ] **Step 3: 在 OrderService 类末尾追加 cancelOrder + 私有 helper**

```typescript
  private async getOrderOwnedByUserOrThrow(userId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  async cancelOrder(userId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    const preRefundStates = ['PENDING_ACCEPT', 'ACCEPTED', 'PENDING_PAYMENT'];
    const postPaymentStates = ['PAID', 'IN_PROGRESS'];
    let targetState: 'CANCELLED' | 'REFUNDED';
    if (preRefundStates.includes(order.state)) {
      targetState = 'CANCELLED';
    } else if (postPaymentStates.includes(order.state)) {
      targetState = 'REFUNDED';
    } else {
      throw new ConflictException('订单状态不允许取消');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: targetState },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_CANCELLED',
      payload: { orderId, by: 'USER' },
      orderId,
    });
    return updated;
  }
```

- [ ] **Step 4: 跑通过**: `pnpm test -- order.service` → 16 passed（10 + 6 = 16；it.each 5 cases + 3 单独）。Expected: PASS, 18 tests (5 it.each cases + 3 singles + previous 10 = 18). 实际数以测试运行为准。

- [ ] **Step 5: Commit**

```bash
git add src/order/order.service.ts src/order/order.service.spec.ts
git commit -m "feat(backend): order cancel with state-aware terminal

Refs #9"
```

---

### Task 7: OrderService — requestPayment + confirmPayment + 单测

**Files:**
- Modify: `backend/src/order/order.service.ts`
- Modify: `backend/src/order/order.service.spec.ts`

`requestPayment(userId, orderId)`：调 `WechatPayService.createPaymentIntent`，把订单从 `ACCEPTED → PENDING_PAYMENT`，返回 `{ paymentIntent, order }`。

`confirmPayment(orderId)`：从支付回调进入，把 `PENDING_PAYMENT → PAID → IN_PROGRESS`，同时设 `deliveryDeadline = now + skuSnapshot.deliveryHour 小时`，发 `ORDER_PAID` 系统卡片。

- [ ] **Step 1: spec 末尾追加 describe**

```typescript
describe('OrderService — payment', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };
  let pay: { createPaymentIntent: jest.Mock };

  beforeEach(async () => {
    prisma = { order: { findUnique: jest.fn(), update: jest.fn() } };
    conv = { addSystemCard: jest.fn() };
    pay = { createPaymentIntent: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
        { provide: WechatPayService, useValue: pay },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('requestPayment', () => {
    it('transitions ACCEPTED → PENDING_PAYMENT and returns payment intent', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'ACCEPTED', conversationId: 'c1', finalPrice: 9900,
        skuSnapshot: { name: 'x' },
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'PENDING_PAYMENT' });
      pay.createPaymentIntent.mockResolvedValue({
        prepayId: 'STUB_PREPAY_o1', outTradeNo: 'STUB_o1', signTimestamp: '1',
      });
      const result = await service.requestPayment('u1', 'o1', 'wx_oid');
      expect(result.order.state).toBe('PENDING_PAYMENT');
      expect(result.paymentIntent.prepayId).toBe('STUB_PREPAY_o1');
      expect(pay.createPaymentIntent).toHaveBeenCalledWith({
        orderId: 'o1', amount: 9900, openid: 'wx_oid', description: 'x',
      });
    });

    it('rejects when order is not in ACCEPTED state', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'PENDING_ACCEPT',
      });
      await expect(service.requestPayment('u1', 'o1', 'wx_oid')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'ACCEPTED',
      });
      await expect(service.requestPayment('u1', 'o1', 'wx_oid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmPayment', () => {
    it('transitions PENDING_PAYMENT → IN_PROGRESS, sets deliveryDeadline, sends ORDER_PAID', async () => {
      const acceptedAt = new Date('2026-05-26T00:00:00Z');
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', state: 'PENDING_PAYMENT', conversationId: 'c1', finalPrice: 9900,
        acceptedAt,
        skuSnapshot: { deliveryHour: 48, type: 'ASYNC_REPORT' },
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'IN_PROGRESS' });
      const result = await service.confirmPayment('o1');
      expect(result.state).toBe('IN_PROGRESS');
      const arg = prisma.order.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'o1' });
      expect(arg.data.state).toBe('IN_PROGRESS');
      expect(arg.data.deliveryDeadline).toBeInstanceOf(Date);
      // 48h from now (not from acceptedAt — deadline 起算 = 付款成功时刻)
      const expectedMs = Date.now() + 48 * 3600 * 1000;
      expect(Math.abs(arg.data.deliveryDeadline.getTime() - expectedMs)).toBeLessThan(5000);
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_PAID',
          payload: { orderId: 'o1', paidAmount: 9900 },
        }),
      );
    });

    it('rejects when not in PENDING_PAYMENT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', state: 'ACCEPTED',
      });
      await expect(service.confirmPayment('o1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFound when order missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.confirmPayment('x')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: 在 spec 头部追加 WechatPayService 的 import**

```typescript
import { WechatPayService } from '../payment/wechat-pay.service';
```

- [ ] **Step 3: 跑失败**: `pnpm test -- order.service` → FAIL（方法 + DI 缺失）。

- [ ] **Step 4: 修改 OrderService**：在构造函数注入 `WechatPayService`；新增两个方法。完整修改：

```typescript
import { WechatPayService } from '../payment/wechat-pay.service';
// ...
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
    private readonly wechatPay: WechatPayService,
  ) {}
// ...
  async requestPayment(
    userId: string,
    orderId: string,
    openid: string,
  ): Promise<{ order: Order; paymentIntent: { prepayId: string; outTradeNo: string; signTimestamp: string } }> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'ACCEPTED') {
      throw new ConflictException('订单状态不允许发起支付');
    }
    const sku = order.skuSnapshot as { name: string };
    const paymentIntent = await this.wechatPay.createPaymentIntent({
      orderId,
      amount: order.finalPrice,
      openid,
      description: sku.name,
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'PENDING_PAYMENT' },
    });
    return { order: updated, paymentIntent };
  }

  async confirmPayment(orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.state !== 'PENDING_PAYMENT') {
      throw new ConflictException('订单状态不允许确认支付');
    }
    const snapshot = order.skuSnapshot as { deliveryHour?: number };
    const hours = snapshot.deliveryHour ?? 0;
    const deadline = new Date(Date.now() + hours * 3600 * 1000);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'IN_PROGRESS', deliveryDeadline: deadline },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_PAID',
      payload: { orderId, paidAmount: order.finalPrice },
      orderId,
    });
    return updated;
  }
```

- [ ] **Step 5: 跑通过**: `pnpm test -- order.service` → 23 passed（previous 18 + requestPayment 3 + confirmPayment 3 - 我估算有点偏移；以实际为准）。

- [ ] **Step 6: Commit**

```bash
git add src/order/order.service.ts src/order/order.service.spec.ts
git commit -m "feat(backend): order payment intent + confirm transitions

Refs #9 #12"
```

---

### Task 8: OrderService — deliver / confirmDelivery / disputeOrder + 单测

**Files:**
- Modify: `backend/src/order/order.service.ts`
- Modify: `backend/src/order/order.service.spec.ts`

异步交付：师傅上传 artifact URL（COS 真上传走 Plan 4 或后续），落 Asset 行，订单 `IN_PROGRESS → DELIVERED`。用户确认 → `COMPLETED`；用户异议 → `IN_DISPUTE` + 新建 DisputeCase。

- [ ] **Step 1: spec 末尾追加 describe**

```typescript
describe('OrderService — delivery / confirm / dispute', () => {
  let service: OrderService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    asset: { create: jest.Mock };
    disputeCase: { create: jest.Mock };
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      asset: { create: jest.fn() },
      disputeCase: { create: jest.fn() },
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
        { provide: WechatPayService, useValue: { createPaymentIntent: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(OrderService);
  });

  describe('deliverOrder', () => {
    it('creates Asset and transitions IN_PROGRESS → DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.asset.create.mockResolvedValue({ id: 'a1' });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'DELIVERED' });
      const result = await service.deliverOrder('m1', 'o1', {
        artifactUrl: 'https://cos.example/report.pdf',
        description: '完整报告 + 卦象图',
      });
      expect(result.state).toBe('DELIVERED');
      expect(prisma.asset.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'm1',
          ownerType: 'MASTER',
          category: 'delivery_report',
          url: 'https://cos.example/report.pdf',
          metadata: { description: '完整报告 + 卦象图' },
          relatedOrderId: 'o1',
        },
      });
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'DELIVERED', deliveredAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_DELIVERED',
          payload: expect.objectContaining({ orderId: 'o1', assetId: 'a1' }),
        }),
      );
    });

    it('rejects when state is not IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(
        service.deliverOrder('m1', 'o1', { artifactUrl: 'u', description: 'd' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR (master does not own order)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'IN_PROGRESS',
      });
      await expect(
        service.deliverOrder('m1', 'o1', { artifactUrl: 'u', description: 'd' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmDelivery', () => {
    it('transitions DELIVERED → COMPLETED with system card', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'COMPLETED' });
      const result = await service.confirmDelivery('u1', 'o1');
      expect(result.state).toBe('COMPLETED');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { state: 'COMPLETED', completedAt: expect.any(Date) },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'ORDER_COMPLETED' }),
      );
    });

    it('rejects when not DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS',
      });
      await expect(service.confirmDelivery('u1', 'o1')).rejects.toThrow(ConflictException);
    });
  });

  describe('disputeOrder', () => {
    it('transitions DELIVERED → IN_DISPUTE and creates DisputeCase', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'DELIVERED', conversationId: 'c1',
      });
      prisma.disputeCase.create.mockResolvedValue({ id: 'd1' });
      prisma.order.update.mockResolvedValue({ id: 'o1', state: 'IN_DISPUTE' });
      const result = await service.disputeOrder('u1', 'o1', {
        reason: '交付物简陋',
        userStatement: '只发了一段语音，没有正式报告',
        evidence: ['https://img/1.png'],
      });
      expect(result.state).toBe('IN_DISPUTE');
      expect(prisma.disputeCase.create).toHaveBeenCalledWith({
        data: {
          orderId: 'o1',
          userId: 'u1',
          reason: '交付物简陋',
          userStatement: '只发了一段语音，没有正式报告',
          evidence: ['https://img/1.png'],
        },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'ORDER_DISPUTED',
          payload: expect.objectContaining({ orderId: 'o1', disputeId: 'd1' }),
        }),
      );
    });

    it('rejects when not DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'COMPLETED',
      });
      await expect(
        service.disputeOrder('u1', 'o1', {
          reason: 'x', userStatement: 'y', evidence: [],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- order.service` → FAIL（方法缺失）。

- [ ] **Step 3: 在 OrderService 末尾追加三个方法**

```typescript
  async deliverOrder(
    masterId: string,
    orderId: string,
    input: { artifactUrl: string; description: string },
  ): Promise<Order> {
    const order = await this.getOrderOwnedByMasterOrThrow(masterId, orderId);
    if (order.state !== 'IN_PROGRESS') {
      throw new ConflictException('订单状态不允许交付');
    }
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: masterId,
        ownerType: 'MASTER',
        category: 'delivery_report',
        url: input.artifactUrl,
        metadata: { description: input.description },
        relatedOrderId: orderId,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'DELIVERED', deliveredAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_DELIVERED',
      payload: { orderId, assetId: asset.id, description: input.description },
      orderId,
    });
    return updated;
  }

  async confirmDelivery(userId: string, orderId: string): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'DELIVERED') {
      throw new ConflictException('订单状态不允许确认收货');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'COMPLETED', completedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_COMPLETED',
      payload: { orderId },
      orderId,
    });
    return updated;
  }

  async disputeOrder(
    userId: string,
    orderId: string,
    input: { reason: string; userStatement: string; evidence: string[] },
  ): Promise<Order> {
    const order = await this.getOrderOwnedByUserOrThrow(userId, orderId);
    if (order.state !== 'DELIVERED') {
      throw new ConflictException('订单状态不允许发起异议');
    }
    const dispute = await this.prisma.disputeCase.create({
      data: {
        orderId,
        userId,
        reason: input.reason,
        userStatement: input.userStatement,
        evidence: input.evidence,
      },
    });
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { state: 'IN_DISPUTE' },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'ORDER_DISPUTED',
      payload: { orderId, disputeId: dispute.id },
      orderId,
    });
    return updated;
  }
```

- [ ] **Step 4: 跑通过**: `pnpm test -- order.service` → 全套通过（previous + deliver 3 + confirm 2 + dispute 2 = 7 new）。

- [ ] **Step 5: Commit**

```bash
git add src/order/order.service.ts src/order/order.service.spec.ts
git commit -m "feat(backend): order deliver/confirm/dispute transitions

Refs #9"
```

---

### Task 9: PriceChangeService — propose / respond + 单测

**Files:**
- Create: `backend/src/order/price-change.service.ts`
- Test: `backend/src/order/price-change.service.spec.ts`

允许 propose 的源状态：`ACCEPTED / PENDING_PAYMENT / PAID / IN_PROGRESS`。respond.ACCEPTED 时更新 `Order.finalPrice` 和 `platformFee`。

- [ ] **Step 1: 失败测试**

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PriceChangeService } from './price-change.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('PriceChangeService', () => {
  let service: PriceChangeService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    priceChange: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      priceChange: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceChangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(PriceChangeService);
  });

  describe('propose', () => {
    it('creates a PENDING price change in IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900, conversationId: 'c1',
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      prisma.priceChange.create.mockResolvedValue({
        id: 'pc1', orderId: 'o1', fromPrice: 9900, toPrice: 19900,
      });
      const result = await service.propose('m1', 'o1', { newPrice: 19900, reason: '需追加八字' });
      expect(result.id).toBe('pc1');
      expect(prisma.priceChange.create).toHaveBeenCalledWith({
        data: { orderId: 'o1', fromPrice: 9900, toPrice: 19900, reason: '需追加八字' },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'PRICE_CHANGE_REQUEST',
          payload: expect.objectContaining({ priceChangeId: 'pc1', fromPrice: 9900, toPrice: 19900 }),
        }),
      );
    });

    it('rejects when there is already a PENDING price change on this order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when order is in DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'DELIVERED',
      });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm_other', state: 'IN_PROGRESS',
      });
      await expect(
        service.propose('m1', 'o1', { newPrice: 19900, reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when newPrice equals current finalPrice', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { newPrice: 9900, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects newPrice below 1', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', finalPrice: 9900,
      });
      prisma.priceChange.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { newPrice: 0, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respond', () => {
    it('ACCEPTED → updates finalPrice + platformFee + decision card', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING', toPrice: 19900,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          priceChange: { update: jest.fn().mockResolvedValue({ id: 'pc1', status: 'ACCEPTED' }) },
          order: { update: jest.fn().mockResolvedValue({ id: 'o1', finalPrice: 19900, platformFee: 1990 }) },
        }),
      );
      const result = await service.respond('u1', 'pc1', 'ACCEPTED');
      expect(result.status).toBe('ACCEPTED');
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'PRICE_CHANGE_DECIDED',
          payload: expect.objectContaining({ priceChangeId: 'pc1', decision: 'ACCEPTED' }),
        }),
      );
    });

    it('REJECTED → marks status, no order update, decision card', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING', toPrice: 19900,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.priceChange.update.mockResolvedValue({ id: 'pc1', status: 'REJECTED' });
      const result = await service.respond('u1', 'pc1', 'REJECTED');
      expect(result.status).toBe('REJECTED');
    });

    it('rejects when price change is not PENDING', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'ACCEPTED',
      });
      await expect(service.respond('u1', 'pc1', 'ACCEPTED')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR (user is not the order owner)', async () => {
      prisma.priceChange.findUnique.mockResolvedValue({
        id: 'pc1', orderId: 'o1', status: 'PENDING',
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'IN_PROGRESS',
      });
      await expect(service.respond('u1', 'pc1', 'ACCEPTED')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- price-change.service` → FAIL（模块不存在）。

- [ ] **Step 3: 实现** `backend/src/order/price-change.service.ts`

```typescript
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PriceChange } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

const PROPOSE_ALLOWED_STATES = new Set([
  'ACCEPTED',
  'PENDING_PAYMENT',
  'PAID',
  'IN_PROGRESS',
]);

function computePlatformFee(amount: number): number {
  return Math.floor(amount * 0.1);
}

@Injectable()
export class PriceChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async propose(
    masterId: string,
    orderId: string,
    input: { newPrice: number; reason: string },
  ): Promise<PriceChange> {
    if (input.newPrice < 1) {
      throw new BadRequestException('新价格必须为正整数（单位：分）');
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    if (!PROPOSE_ALLOWED_STATES.has(order.state)) {
      throw new ConflictException('订单状态不允许发起改价');
    }
    if (order.finalPrice === input.newPrice) {
      throw new BadRequestException('新价格与当前价格相同');
    }
    const pending = await this.prisma.priceChange.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException('已有未处理的改价请求');
    }
    const created = await this.prisma.priceChange.create({
      data: {
        orderId,
        fromPrice: order.finalPrice,
        toPrice: input.newPrice,
        reason: input.reason,
      },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'PRICE_CHANGE_REQUEST',
      payload: {
        orderId,
        priceChangeId: created.id,
        fromPrice: order.finalPrice,
        toPrice: input.newPrice,
        reason: input.reason,
      },
      orderId,
    });
    return created;
  }

  async respond(
    userId: string,
    priceChangeId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<PriceChange> {
    const pc = await this.prisma.priceChange.findUnique({ where: { id: priceChangeId } });
    if (!pc) throw new NotFoundException('改价请求不存在');
    if (pc.status !== 'PENDING') {
      throw new ConflictException('改价请求已被处理');
    }
    const order = await this.prisma.order.findUnique({ where: { id: pc.orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }

    if (decision === 'ACCEPTED') {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.priceChange.update({
          where: { id: priceChangeId },
          data: { status: 'ACCEPTED', decidedAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { finalPrice: pc.toPrice, platformFee: computePlatformFee(pc.toPrice) },
        });
        return updated;
      });
      await this.conversation.addSystemCard({
        conversationId: order.conversationId,
        cardType: 'PRICE_CHANGE_DECIDED',
        payload: { orderId: order.id, priceChangeId, decision: 'ACCEPTED' },
        orderId: order.id,
      });
      return result;
    }

    const updated = await this.prisma.priceChange.update({
      where: { id: priceChangeId },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'PRICE_CHANGE_DECIDED',
      payload: { orderId: order.id, priceChangeId, decision: 'REJECTED' },
      orderId: order.id,
    });
    return updated;
  }
}
```

- [ ] **Step 4: 跑通过**: `pnpm test -- price-change.service` → 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/order/price-change.service.ts src/order/price-change.service.spec.ts
git commit -m "feat(backend): PriceChangeService propose/respond

Refs #9"
```

---

### Task 10: ExtensionService — propose / respond + 单测

**Files:**
- Create: `backend/src/order/extension.service.ts`
- Test: `backend/src/order/extension.service.spec.ts`

允许 propose 的源状态：`IN_PROGRESS` only（spec §5.2.3 师傅 申请延期 触发状态 = 处理中）。respond.ACCEPTED 时把 `Order.deliveryDeadline += additionalHours`。

- [ ] **Step 1: 失败测试**

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExtensionService } from './extension.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

describe('ExtensionService', () => {
  let service: ExtensionService;
  let prisma: {
    order: { findUnique: jest.Mock; update: jest.Mock };
    extensionRequest: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let conv: { addSystemCard: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: { findUnique: jest.fn(), update: jest.fn() },
      extensionRequest: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    conv = { addSystemCard: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExtensionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConversationService, useValue: conv },
      ],
    }).compile();
    service = moduleRef.get(ExtensionService);
  });

  describe('propose', () => {
    it('creates a PENDING extension request in IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue(null);
      prisma.extensionRequest.create.mockResolvedValue({ id: 'ex1' });
      const result = await service.propose('m1', 'o1', { additionalHours: 24, reason: '资料补充中' });
      expect(result.id).toBe('ex1');
      expect(prisma.extensionRequest.create).toHaveBeenCalledWith({
        data: { orderId: 'o1', additionalHours: 24, reason: '资料补充中' },
      });
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardType: 'EXTENSION_REQUEST',
          payload: expect.objectContaining({ extensionId: 'ex1', additionalHours: 24 }),
        }),
      );
    });

    it('rejects when state is not IN_PROGRESS', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'ACCEPTED',
      });
      await expect(
        service.propose('m1', 'o1', { additionalHours: 24, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when there is already a PENDING extension', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue({ id: 'ex_existing' });
      await expect(
        service.propose('m1', 'o1', { additionalHours: 24, reason: 'x' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects additionalHours not in [1, 168]', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', masterId: 'm1', state: 'IN_PROGRESS',
      });
      prisma.extensionRequest.findFirst.mockResolvedValue(null);
      await expect(
        service.propose('m1', 'o1', { additionalHours: 0, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.propose('m1', 'o1', { additionalHours: 169, reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('respond', () => {
    it('ACCEPTED → updates Order.deliveryDeadline and decision card', async () => {
      const base = new Date('2026-05-26T00:00:00Z');
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING', additionalHours: 24,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1', deliveryDeadline: base,
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          extensionRequest: { update: jest.fn().mockResolvedValue({ id: 'ex1', status: 'ACCEPTED' }) },
          order: { update: jest.fn().mockResolvedValue({ id: 'o1' }) },
        }),
      );
      const result = await service.respond('u1', 'ex1', 'ACCEPTED');
      expect(result.status).toBe('ACCEPTED');
      expect(conv.addSystemCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: 'EXTENSION_DECIDED' }),
      );
    });

    it('REJECTED → no deadline change, decision card', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING', additionalHours: 24,
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u1', state: 'IN_PROGRESS', conversationId: 'c1',
      });
      prisma.extensionRequest.update.mockResolvedValue({ id: 'ex1', status: 'REJECTED' });
      const result = await service.respond('u1', 'ex1', 'REJECTED');
      expect(result.status).toBe('REJECTED');
    });

    it('rejects when extension not PENDING', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', status: 'ACCEPTED',
      });
      await expect(service.respond('u1', 'ex1', 'ACCEPTED')).rejects.toThrow(ConflictException);
    });

    it('rejects IDOR', async () => {
      prisma.extensionRequest.findUnique.mockResolvedValue({
        id: 'ex1', orderId: 'o1', status: 'PENDING',
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1', userId: 'u_other', state: 'IN_PROGRESS',
      });
      await expect(service.respond('u1', 'ex1', 'ACCEPTED')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: 跑失败**: `pnpm test -- extension.service` → FAIL（模块不存在）。

- [ ] **Step 3: 实现** `backend/src/order/extension.service.ts`

```typescript
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ExtensionRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';

@Injectable()
export class ExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
  ) {}

  async propose(
    masterId: string,
    orderId: string,
    input: { additionalHours: number; reason: string },
  ): Promise<ExtensionRequest> {
    if (input.additionalHours < 1 || input.additionalHours > 168) {
      throw new BadRequestException('延期小时数必须在 1-168 之间');
    }
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.masterId !== masterId) {
      throw new NotFoundException('订单不存在');
    }
    if (order.state !== 'IN_PROGRESS') {
      throw new ConflictException('订单状态不允许申请延期');
    }
    const pending = await this.prisma.extensionRequest.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pending) {
      throw new ConflictException('已有未处理的延期申请');
    }
    const created = await this.prisma.extensionRequest.create({
      data: { orderId, additionalHours: input.additionalHours, reason: input.reason },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'EXTENSION_REQUEST',
      payload: { orderId, extensionId: created.id, additionalHours: input.additionalHours, reason: input.reason },
      orderId,
    });
    return created;
  }

  async respond(
    userId: string,
    extensionId: string,
    decision: 'ACCEPTED' | 'REJECTED',
  ): Promise<ExtensionRequest> {
    const ext = await this.prisma.extensionRequest.findUnique({ where: { id: extensionId } });
    if (!ext) throw new NotFoundException('延期申请不存在');
    if (ext.status !== 'PENDING') {
      throw new ConflictException('延期申请已被处理');
    }
    const order = await this.prisma.order.findUnique({ where: { id: ext.orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }

    if (decision === 'ACCEPTED') {
      const newDeadline = order.deliveryDeadline
        ? new Date(order.deliveryDeadline.getTime() + ext.additionalHours * 3600 * 1000)
        : new Date(Date.now() + ext.additionalHours * 3600 * 1000);
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.extensionRequest.update({
          where: { id: extensionId },
          data: { status: 'ACCEPTED', decidedAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { deliveryDeadline: newDeadline },
        });
        return updated;
      });
      await this.conversation.addSystemCard({
        conversationId: order.conversationId,
        cardType: 'EXTENSION_DECIDED',
        payload: { orderId: order.id, extensionId, decision: 'ACCEPTED' },
        orderId: order.id,
      });
      return result;
    }

    const updated = await this.prisma.extensionRequest.update({
      where: { id: extensionId },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    await this.conversation.addSystemCard({
      conversationId: order.conversationId,
      cardType: 'EXTENSION_DECIDED',
      payload: { orderId: order.id, extensionId, decision: 'REJECTED' },
      orderId: order.id,
    });
    return updated;
  }
}
```

- [ ] **Step 4: 跑通过**: `pnpm test -- extension.service` → 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/order/extension.service.ts src/order/extension.service.spec.ts
git commit -m "feat(backend): ExtensionService propose/respond

Refs #9"
```

---

### Task 11: Order DTOs + USER-side OrderController + Payment notify + e2e

**Files:**
- Create: `backend/src/order/dto/create-order.dto.ts`
- Create: `backend/src/order/dto/dispute-order.dto.ts`
- Create: `backend/src/order/order.controller.ts`
- Create: `backend/src/payment/dto/wechat-pay-notify.dto.ts`
- Create: `backend/src/payment/payment-notify.controller.ts`
- Create: `backend/src/order/order.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/payment/payment.module.ts`
- Test: `backend/test/e2e/order-lifecycle.e2e-spec.ts`

USER 端口端点：
- `POST /orders` — 创建订单
- `POST /orders/:id/pay` — 申请支付（返回 stub 支付参数）
- `POST /orders/:id/cancel` — 取消
- `POST /orders/:id/confirm-delivery` — 确认收货
- `POST /orders/:id/dispute` — 异议
- `GET /orders` — 列出本人订单（按 createdAt desc）
- `GET /orders/:id` — 详情（含 ownership 校验）

Payment notify 端点（无鉴权）：
- `POST /payments/wechat/notify` — 接收 stub 回调，触发 confirmPayment

- [ ] **Step 1: DTOs**

`backend/src/order/dto/create-order.dto.ts`:
```typescript
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ description: 'SKU id' })
  @IsString()
  skuId!: string;
}
```

`backend/src/order/dto/dispute-order.dto.ts`:
```typescript
import { IsArray, IsString, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisputeOrderDto {
  @ApiProperty({ description: '异议原因（模板词）' })
  @IsString()
  @MaxLength(100)
  reason!: string;

  @ApiProperty({ description: '详细说明' })
  @IsString()
  @MaxLength(2000)
  userStatement!: string;

  @ApiProperty({ description: '证据图 URL 数组', example: [] })
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  evidence!: string[];
}
```

`backend/src/payment/dto/wechat-pay-notify.dto.ts`:
```typescript
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WechatPayNotifyDto {
  @ApiProperty({ description: 'stub: 微信返回的 out_trade_no' })
  @IsString()
  outTradeNo!: string;
}
```

- [ ] **Step 2: OrderController** `backend/src/order/order.controller.ts`

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DisputeOrderDto } from './dto/dispute-order.dto';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('USER')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建订单' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(user.id, dto.skuId);
  }

  @Get()
  @ApiOperation({ summary: '列出本人订单' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（仅本人）' })
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== user.id) {
      // unify 404 to avoid revealing existence
      throw new (await import('@nestjs/common')).NotFoundException('订单不存在');
    }
    return order;
  }

  @Post(':id/pay')
  @ApiOperation({ summary: '申请支付（返回 stub 支付参数）' })
  pay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    // openid 由后端从 user 关联表回查；此处为 MVP 简化，直接传占位
    return this.orders.requestPayment(user.id, id, `openid_${user.id}`);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消订单' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.cancelOrder(user.id, id);
  }

  @Post(':id/confirm-delivery')
  @ApiOperation({ summary: '确认收货' })
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.confirmDelivery(user.id, id);
  }

  @Post(':id/dispute')
  @ApiOperation({ summary: '发起异议' })
  dispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeOrderDto,
  ) {
    return this.orders.disputeOrder(user.id, id, dto);
  }
}
```

> 注：`import('@nestjs/common').NotFoundException` 写法避免顶部又加一行 import。更干净的做法是顶部 `import { NotFoundException }` —— 实现时直接放顶部即可。

- [ ] **Step 3: PaymentNotifyController** `backend/src/payment/payment-notify.controller.ts`

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WechatPayService } from './wechat-pay.service';
import { WechatPayNotifyDto } from './dto/wechat-pay-notify.dto';
import { OrderService } from '../order/order.service';

@ApiTags('payment')
@Controller('payments/wechat')
export class PaymentNotifyController {
  constructor(
    private readonly wechatPay: WechatPayService,
    private readonly orders: OrderService,
  ) {}

  @Post('notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信支付回调（stub）' })
  async notify(@Body() body: WechatPayNotifyDto) {
    if (!this.wechatPay.verifyNotify(body)) {
      throw new BadRequestException('签名校验失败');
    }
    const orderId = this.wechatPay.parseOrderIdFromTradeNo(body.outTradeNo);
    if (!orderId) {
      throw new BadRequestException('无法解析 outTradeNo');
    }
    await this.orders.confirmPayment(orderId);
    return { ok: true };
  }
}
```

- [ ] **Step 4: OrderModule** `backend/src/order/order.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PriceChangeService } from './price-change.service';
import { ExtensionService } from './extension.service';
import { ConversationModule } from '../conversation/conversation.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [ConversationModule, PaymentModule],
  controllers: [OrderController],
  providers: [OrderService, PriceChangeService, ExtensionService],
  exports: [OrderService],
})
export class OrderModule {}
```

> Task 13 / 14 会扩展 controllers 加入 master-order / price-change / extension controllers。本任务先只挂 OrderController。

- [ ] **Step 5: PaymentModule 扩展** — 改 `backend/src/payment/payment.module.ts` 为：

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { WechatPayService } from './wechat-pay.service';
import { PaymentNotifyController } from './payment-notify.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [forwardRef(() => OrderModule)],
  controllers: [PaymentNotifyController],
  providers: [WechatPayService],
  exports: [WechatPayService],
})
export class PaymentModule {}
```

> `forwardRef` 因为 OrderModule 也 import PaymentModule（拿 WechatPayService），形成循环。NestJS 标准解法。

- [ ] **Step 6: AppModule** — 加 `OrderModule`：

```typescript
import { OrderModule } from './order/order.module';
// ...
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    MasterModule,
    AdminModule,
    PaymentModule,
    ConversationModule,
    OrderModule,
  ],
```

- [ ] **Step 7: E2E** `backend/test/e2e/order-lifecycle.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Order lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let userId: string;
  let masterId: string;
  let skuId: string;
  let conversationId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);

    const user = await prisma.user.create({ data: { openid: 'wx_e2e_order_u' } });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139701', status: 'ACTIVE', onboardingStep: 'LIVE',
        displayName: '玄一', avatar: '', intro: '',
        experience: '', philosophy: '', methods: ['八字'], topics: ['事业咨询'],
      },
    });
    masterId = master.id;
    const sku = await prisma.serviceSKU.create({
      data: {
        masterId, name: '八字解读报告', type: 'ASYNC_REPORT',
        price: 9900, deliveryHour: 48, description: '完整书面报告',
      },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.asset.deleteMany({ where: { relatedOrderId: { not: null }, ownerId: masterId } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });

  it('full happy path: create → (master accept via DB) → pay → notify → deliver(DB) → confirm', async () => {
    // create
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    expect(created.body.data.state).toBe('PENDING_ACCEPT');
    expect(created.body.data.platformFee).toBe(990);
    conversationId = created.body.data.conversationId;

    // master accept via DB (master controller in Task 12)
    await prisma.order.update({
      where: { id: orderId },
      data: { state: 'ACCEPTED', acceptedAt: new Date() },
    });

    // user pay
    const payResp = await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(payResp.body.data.paymentIntent.prepayId).toBe(`STUB_PREPAY_${orderId}`);
    expect(payResp.body.data.order.state).toBe('PENDING_PAYMENT');

    // notify (no auth)
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: `STUB_${orderId}` })
      .expect(200);
    const afterPay = await prisma.order.findUnique({ where: { id: orderId } });
    expect(afterPay?.state).toBe('IN_PROGRESS');
    expect(afterPay?.deliveryDeadline).toBeInstanceOf(Date);

    // master deliver via DB (master controller in Task 12)
    await prisma.order.update({
      where: { id: orderId },
      data: { state: 'DELIVERED', deliveredAt: new Date() },
    });

    // user confirm
    const confirmed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(confirmed.body.data.state).toBe('COMPLETED');
  });

  it('cancel from PENDING_ACCEPT → CANCELLED', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const cancelled = await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(cancelled.body.data.state).toBe('CANCELLED');
  });

  it('payment notify with invalid trade no returns 400', async () => {
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: 'NOT_STUB_FORMAT' })
      .expect(400);
  });

  it('rejects USER endpoint without USER role (401)', async () => {
    await request(app.getHttpServer()).get('/orders').expect(401);
  });
});
```

> 说明：本 e2e 在「接单/交付」两步**直接改 DB**，因为 master controller 还在 Task 12。Task 12 完成后会有真正的 master-side e2e 测端到端。

- [ ] **Step 8: 跑通过**: `pnpm exec jest --config ./test/jest-e2e.json order-lifecycle` → 4 passed.

- [ ] **Step 9: Commit**

```bash
git add src/order/dto src/order/order.controller.ts src/order/order.module.ts src/payment/dto src/payment/payment-notify.controller.ts src/payment/payment.module.ts src/app.module.ts test/e2e/order-lifecycle.e2e-spec.ts
git commit -m "feat(backend): user order endpoints + wechat pay notify + e2e

Refs #9 #12"
```

---

### Task 12: MASTER-side OrderController（接单/拒单/交付）+ DTO + e2e

**Files:**
- Create: `backend/src/order/dto/reject-order.dto.ts`
- Create: `backend/src/order/dto/deliver-order.dto.ts`
- Create: `backend/src/order/master-order.controller.ts`
- Modify: `backend/src/order/order.module.ts`（追加 controller）
- Test: `backend/test/e2e/master-order.e2e-spec.ts`

师傅端口：
- `GET /masters/me/orders` — 列出本人订单
- `POST /masters/me/orders/:id/accept`
- `POST /masters/me/orders/:id/reject`（body: reason）
- `POST /masters/me/orders/:id/deliver`（body: artifactUrl + description）

- [ ] **Step 1: DTOs**

`backend/src/order/dto/reject-order.dto.ts`:
```typescript
import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectOrderDto {
  @ApiProperty({ description: '拒单原因' })
  @IsString()
  @MaxLength(200)
  reason!: string;
}
```

`backend/src/order/dto/deliver-order.dto.ts`:
```typescript
import { IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeliverOrderDto {
  @ApiProperty({ description: '交付物 URL（COS 上传后地址）' })
  @IsString()
  @IsUrl()
  @MaxLength(500)
  artifactUrl!: string;

  @ApiProperty({ description: '交付说明' })
  @IsString()
  @MaxLength(2000)
  description!: string;
}
```

- [ ] **Step 2: MasterOrderController** `backend/src/order/master-order.controller.ts`

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderService } from './order.service';
import { RejectOrderDto } from './dto/reject-order.dto';
import { DeliverOrderDto } from './dto/deliver-order.dto';

@ApiTags('master-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/orders')
export class MasterOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出本人订单' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.order.findMany({
      where: { masterId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post(':id/accept')
  @ApiOperation({ summary: '接单' })
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.acceptOrder(user.id, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: '拒单' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.orders.rejectOrder(user.id, id, dto.reason);
  }

  @Post(':id/deliver')
  @ApiOperation({ summary: '交付（上传 artifact URL）' })
  deliver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeliverOrderDto,
  ) {
    return this.orders.deliverOrder(user.id, id, dto);
  }
}
```

- [ ] **Step 3: 接入 OrderModule** — 修改 `backend/src/order/order.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MasterOrderController } from './master-order.controller';
import { PriceChangeService } from './price-change.service';
import { ExtensionService } from './extension.service';
import { ConversationModule } from '../conversation/conversation.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [ConversationModule, PaymentModule],
  controllers: [OrderController, MasterOrderController],
  providers: [OrderService, PriceChangeService, ExtensionService],
  exports: [OrderService],
})
export class OrderModule {}
```

- [ ] **Step 4: E2E** `backend/test/e2e/master-order.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

describe('Master order endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let userId: string;
  let masterId: string;
  let skuId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);

    const user = await prisma.user.create({ data: { openid: 'wx_e2e_morder_u' } });
    userId = user.id;
    const master = await prisma.master.create({
      data: {
        phone: '13900139702', status: 'ACTIVE', onboardingStep: 'LIVE',
        displayName: 'x', avatar: '', intro: '',
        experience: '', philosophy: '', methods: ['八字'], topics: ['事业咨询'],
      },
    });
    masterId = master.id;
    const sku = await prisma.serviceSKU.create({
      data: { masterId, name: 'x', type: 'ASYNC_REPORT', price: 9900, deliveryHour: 24, description: 'd' },
    });
    skuId = sku.id;
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { conversation: { userId, masterId } } as never });
    await prisma.asset.deleteMany({ where: { ownerId: masterId } });
    await prisma.order.deleteMany({ where: { masterId } });
    await prisma.conversation.deleteMany({ where: { userId, masterId } });
    await prisma.serviceSKU.deleteMany({ where: { masterId } });
    await prisma.master.deleteMany({ where: { id: masterId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  const userToken = () => jwt.sign({ sub: userId, role: 'USER' });
  const masterToken = () => jwt.sign({ sub: masterId, role: 'MASTER' });

  it('master accepts an order, user pays + notify, master delivers via endpoint, user confirms', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;

    const accepted = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .expect(201);
    expect(accepted.body.data.state).toBe('ACCEPTED');

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify')
      .send({ outTradeNo: `STUB_${orderId}` })
      .expect(200);

    const delivered = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ artifactUrl: 'https://cos.example.com/r.pdf', description: '完整报告' })
      .expect(201);
    expect(delivered.body.data.state).toBe('DELIVERED');

    const confirmed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${userToken()}`)
      .expect(201);
    expect(confirmed.body.data.state).toBe('COMPLETED');
  });

  it('master rejects an order with reason → CANCELLED', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const rejected = await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/reject`)
      .set('Authorization', `Bearer ${masterToken()}`)
      .send({ reason: '日程不便' })
      .expect(201);
    expect(rejected.body.data.state).toBe('CANCELLED');
  });

  it('master cannot accept another master\'s order (IDOR → 404)', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ skuId })
      .expect(201);
    const orderId = created.body.data.id as string;
    const otherMaster = await prisma.master.create({
      data: {
        phone: '13900139703', status: 'ACTIVE', onboardingStep: 'LIVE',
        displayName: 'y', avatar: '', intro: '', experience: '', philosophy: '',
        methods: ['塔罗'], topics: ['感情咨询'],
      },
    });
    const otherToken = jwt.sign({ sub: otherMaster.id, role: 'MASTER' });
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await prisma.master.deleteMany({ where: { id: otherMaster.id } });
  });
});
```

> 注：上面 afterAll 的 `prisma.message.deleteMany({ where: { conversation: { userId, masterId } } })` 用了关系筛选；如果你的 Prisma 版本/schema 配置不支持，请改为先查询会话 id 再按 conversationId 删。

- [ ] **Step 5: 跑通过**: `pnpm exec jest --config ./test/jest-e2e.json master-order` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/order/dto/reject-order.dto.ts src/order/dto/deliver-order.dto.ts src/order/master-order.controller.ts src/order/order.module.ts test/e2e/master-order.e2e-spec.ts
git commit -m "feat(backend): master order endpoints (accept/reject/deliver) + e2e

Refs #9"
```

---

### Task 13: PriceChange controllers + DTOs + e2e

**Files:**
- Create: `backend/src/order/dto/propose-price-change.dto.ts`
- Create: `backend/src/order/dto/respond-price-change.dto.ts`
- Create: `backend/src/order/price-change.controller.ts`
- Modify: `backend/src/order/order.module.ts`
- Test: `backend/test/e2e/price-change.e2e-spec.ts`

端点：
- `POST /masters/me/orders/:orderId/price-changes` (MASTER) — propose
- `POST /orders/:orderId/price-changes/:id/respond` (USER) — respond {decision}

- [ ] **Step 1: DTOs**

`backend/src/order/dto/propose-price-change.dto.ts`:
```typescript
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProposePriceChangeDto {
  @ApiProperty({ description: '新价格（分）' })
  @IsInt()
  @Min(1)
  newPrice!: number;

  @ApiProperty({ description: '调整原因' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
```

`backend/src/order/dto/respond-price-change.dto.ts`:
```typescript
import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondPriceChangeDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsString()
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision!: 'ACCEPTED' | 'REJECTED';
}
```

- [ ] **Step 2: Controller** `backend/src/order/price-change.controller.ts`

```typescript
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PriceChangeService } from './price-change.service';
import { ProposePriceChangeDto } from './dto/propose-price-change.dto';
import { RespondPriceChangeDto } from './dto/respond-price-change.dto';

@ApiTags('price-changes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class PriceChangeController {
  constructor(private readonly priceChanges: PriceChangeService) {}

  @Post('masters/me/orders/:orderId/price-changes')
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅发起改价' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ProposePriceChangeDto,
  ) {
    return this.priceChanges.propose(user.id, orderId, dto);
  }

  @Post('orders/:orderId/price-changes/:id/respond')
  @Roles('USER')
  @ApiOperation({ summary: '用户回应改价' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RespondPriceChangeDto,
  ) {
    return this.priceChanges.respond(user.id, id, dto.decision);
  }
}
```

> 注：把两路由放同一 controller 但通过方法级 `@Roles` 区分角色——这是 controller 级 `@Roles('USER')` 改造成单挑写法。`@Controller()`（空 prefix）让两路由都从根 / 开始。

- [ ] **Step 3: 加入 OrderModule** —

```typescript
controllers: [OrderController, MasterOrderController, PriceChangeController],
```

- [ ] **Step 4: E2E** `backend/test/e2e/price-change.e2e-spec.ts`

```typescript
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

    // 创建订单并跑到 IN_PROGRESS 用于 propose
    const userToken = jwt.sign({ sub: userId, role: 'USER' });
    const masterToken = jwt.sign({ sub: masterId, role: 'MASTER' });
    const created = await request(app.getHttpServer())
      .post('/orders').set('Authorization', `Bearer ${userToken}`).send({ skuId }).expect(201);
    orderId = created.body.data.id;
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`).set('Authorization', `Bearer ${masterToken}`).expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`).set('Authorization', `Bearer ${userToken}`).expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify').send({ outTradeNo: `STUB_${orderId}` }).expect(200);
  });

  afterAll(async () => {
    await prisma.priceChange.deleteMany({ where: { orderId } });
    await prisma.message.deleteMany({ where: { conversation: { userId, masterId } } as never });
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
```

- [ ] **Step 5: 跑通过**: `pnpm exec jest --config ./test/jest-e2e.json price-change` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/order/dto/propose-price-change.dto.ts src/order/dto/respond-price-change.dto.ts src/order/price-change.controller.ts src/order/order.module.ts test/e2e/price-change.e2e-spec.ts
git commit -m "feat(backend): price-change endpoints + e2e

Refs #9"
```

---

### Task 14: Extension controllers + DTOs + e2e

**Files:**
- Create: `backend/src/order/dto/propose-extension.dto.ts`
- Create: `backend/src/order/dto/respond-extension.dto.ts`
- Create: `backend/src/order/extension.controller.ts`
- Modify: `backend/src/order/order.module.ts`
- Test: `backend/test/e2e/extension.e2e-spec.ts`

端点：
- `POST /masters/me/orders/:orderId/extensions` (MASTER) — propose
- `POST /orders/:orderId/extensions/:id/respond` (USER) — respond

- [ ] **Step 1: DTOs**

`backend/src/order/dto/propose-extension.dto.ts`:
```typescript
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProposeExtensionDto {
  @ApiProperty({ description: '追加小时数 1-168' })
  @IsInt()
  @Min(1)
  @Max(168)
  additionalHours!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
```

`backend/src/order/dto/respond-extension.dto.ts`:
```typescript
import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondExtensionDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsString()
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision!: 'ACCEPTED' | 'REJECTED';
}
```

- [ ] **Step 2: Controller** `backend/src/order/extension.controller.ts`

```typescript
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ExtensionService } from './extension.service';
import { ProposeExtensionDto } from './dto/propose-extension.dto';
import { RespondExtensionDto } from './dto/respond-extension.dto';

@ApiTags('extensions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class ExtensionController {
  constructor(private readonly extensions: ExtensionService) {}

  @Post('masters/me/orders/:orderId/extensions')
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅申请延期' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ProposeExtensionDto,
  ) {
    return this.extensions.propose(user.id, orderId, dto);
  }

  @Post('orders/:orderId/extensions/:id/respond')
  @Roles('USER')
  @ApiOperation({ summary: '用户回应延期' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RespondExtensionDto,
  ) {
    return this.extensions.respond(user.id, id, dto.decision);
  }
}
```

- [ ] **Step 3: 接入 OrderModule** —

```typescript
controllers: [
  OrderController,
  MasterOrderController,
  PriceChangeController,
  ExtensionController,
],
```

- [ ] **Step 4: E2E** `backend/test/e2e/extension.e2e-spec.ts`

```typescript
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

    const userToken = jwt.sign({ sub: userId, role: 'USER' });
    const masterToken = jwt.sign({ sub: masterId, role: 'MASTER' });
    const created = await request(app.getHttpServer())
      .post('/orders').set('Authorization', `Bearer ${userToken}`).send({ skuId }).expect(201);
    orderId = created.body.data.id;
    await request(app.getHttpServer())
      .post(`/masters/me/orders/${orderId}/accept`).set('Authorization', `Bearer ${masterToken}`).expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/pay`).set('Authorization', `Bearer ${userToken}`).expect(201);
    await request(app.getHttpServer())
      .post('/payments/wechat/notify').send({ outTradeNo: `STUB_${orderId}` }).expect(200);
  });

  afterAll(async () => {
    await prisma.extensionRequest.deleteMany({ where: { orderId } });
    await prisma.message.deleteMany({ where: { conversation: { userId, masterId } } as never });
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
```

- [ ] **Step 5: 跑通过**: `pnpm exec jest --config ./test/jest-e2e.json extension` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/order/dto/propose-extension.dto.ts src/order/dto/respond-extension.dto.ts src/order/extension.controller.ts src/order/order.module.ts test/e2e/extension.e2e-spec.ts
git commit -m "feat(backend): extension endpoints + e2e

Refs #9"
```

---

### Task 15: 全量回归 + lint + build + 最终评审

**Files:** 无新增（验证 + 可能的微调）

- [ ] **Step 1: 全单元**

```bash
export PATH="$HOME/Library/pnpm/bin:$PATH" && cd backend && pnpm test 2>&1 | tail -6
```
Expected: 全套 PASS（73 from Plan 2 + 新增约 ~50 个 from 3a = 120+ 量级）。

- [ ] **Step 2: 全 E2E**

```bash
pnpm test:e2e 2>&1 | tail -6
```
Expected: PASS（31 from Plan 2 + 新增 ~13 from 3a = 44+ 量级）。

- [ ] **Step 3: Lint**

```bash
pnpm lint 2>&1 | tail -3
```
Expected: 无 error。如有改动产生纳入下方 commit。

- [ ] **Step 4: Build**

```bash
pnpm build 2>&1 | tail -3
```
Expected: 成功。

- [ ] **Step 5: 若 lint/build 触发任何文件改动则提交**

```bash
git add -A
git commit -m "chore(backend): lint/format fixups for orders" || echo "nothing to commit"
```

- [ ] **Step 6: 最终人工核对**

逐项确认：
- 所有受保护端点都挂了 `@Roles('USER')` 或 `@Roles('MASTER')`，class-level 或 method-level。
- payment notify 端点无鉴权但走 `WechatPayService.verifyNotify`。
- 11 种 SYSTEM_CARD 类型分别被对应 service 调用、payload 一致。
- 取消的状态分流（pre-payment → CANCELLED, post-payment → REFUNDED）符合状态机文档。
- 改价 platformFee 同步重算；金额单位「分」贯穿。
- 没有 race 条件遗漏（PENDING 改价 / 延期的双重 propose 拦截、支付 confirmPayment 的状态守卫）。
- Plan 2 既有功能未受影响（运行了完整套件验证）。

---

## Self-Review（写计划时已执行）

**1. Spec coverage**（对照 spec §5.2 订单系统、§4 用户旅程、§4.3 担保规则、§5.3.1 SYSTEM_CARD 列表）：
- 状态机全部转换 + 接单/拒单/取消 → Task 5/6 ✅
- 改价 → Task 9/13 ✅
- 延期 → Task 10/14 ✅
- 上传交付物 + 用户确认 / 异议 → Task 8/11/12 ✅
- 改约 → 仅实时 IM 适用（spec §5.2.3「师傅 改约时段」），3a 不做（async report 无 scheduled time），归 Plan 3b ✅
- 沉默规则 7 天自动完成 → 时间型 cron job，3a 不做（plan 5 或 ops 后补）✅
- 24h 师傅不接单自动取消 → 同上，cron job，不在 3a 范围 ✅
- 支付：stub 在 service 边界 ✅；真实联调归 Plan 3c
- SYSTEM_CARD 12 种 → ConversationService 都覆盖了 ✅

**2. Placeholder scan**：无 TBD / TODO；每个 step 都含完整代码或具体命令。

**3. Type consistency**：
- `state` 用 OrderState enum（字符串字面量 `'PENDING_ACCEPT'` 等，与 Prisma 生成的类型兼容）。
- `cardType` 12 种与 ConversationService.SystemCardType 联合类型一致。
- 金额 `Int` 单位分贯穿 ServiceSKU.price → Order.originalPrice/finalPrice/platformFee → WechatPay.amount。
- `decision: 'ACCEPTED' | 'REJECTED'` 与 PriceChangeStatus / ExtensionRequestStatus enum 字面对齐。
- `@CurrentUser().id` 在 USER 控制器 = userId，MASTER 控制器 = masterId。

**已知取舍 / 后续可补**：
- E2E 里手工调用 payment notify 端点（模拟微信 POST），真实联调要在 Plan 3c 替换。
- order detail / list 端点直接走 prisma (controller 内联)，没用 service 包；后续若要加缓存/筛选再抽。
- 改价接受时如果新价低于原价 → 当前直接生效新价，没做「向用户退差」流程。3c 接入真退款时把差额走真退款分支。
- IM 推送：现在只写 Conversation/Message 表，不推到 TIM 客户端。Plan 3b 会扩展 ConversationService.addSystemCard 之后接 TIM SDK push。
- IDOR 在 service 层 unify 404（不区分「订单不存在」 vs「不是你的订单」），与 Plan 2 SKU IDOR 行为一致。
