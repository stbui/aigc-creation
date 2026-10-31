# 支付域重构与后台「支付充值」页设计

> 状态：**规划中，方案待确认，未实施**。
> 目标页面：`http://localhost:3000/admin/payments`（参考实现 `open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`）。
> 参考后端：`open-ai-canvas/backend/internal/app/payment*.go`、`backend/internal/repository/payment.go`、`backend/internal/model/models_payment.go`。
>
> 本文写目标架构与取舍，不把未实现内容写成现状。代码与本文冲突时以代码为准。

---

## 1. 目标与非目标

### 1.1 目标

把当前「环境变量决定单一通道 + 手工 CSV 对账」的支付实现，重构为可运营的多渠道支付域：

1. **多渠道**：支付宝、微信、沙箱可同时存在；每个渠道独立启停、独立配置、独立关闭时限。
2. **后台可配置**：支付渠道的密钥、网关、回调基址在后台维护；密钥加密落库、配置版本化，历史订单固定使用下单时的配置版本。
3. **订单可运维**：后台可向渠道查单、查单后关单；渠道已支付则立即入账，避免「钱收了、订单还挂着」。
4. **回调可靠**：验签后的回调先落持久化收件箱，再异步入账；重复回调、进程重启、短暂数据库故障都不丢单。
5. **T+1 对账闭环**：按渠道下载账单，与本地订单逐笔比对；已支付未入账的订单经**签名查单二次确认**后自动补发权益，其余差异留痕待人工处理。
6. **复刻页面**：新增 `/admin/payments`，四个标签页——支付渠道、充值商品、支付订单、支付对账。交互与信息架构对齐参考页，但使用本仓库的 BoardUI，不引入 antd。

### 1.2 非目标（本轮不做）

| 项 | 原因 |
| --- | --- |
| 存储空间扩容商品（`kind=storage`） | 本仓库没有存储配额模型与上传容量校验；先做会变成「卖了容量但不限流」的假功能。列为 Phase 5 |
| 易支付 / 虎皮椒 / 支付FM 等聚合通道 | 每个通道的下单、验签、查单、账单下载协议都不同；先打通支付宝/微信，再按同一 `PaymentAdapter` 接口扩展 |
| 退款流程重写 | 现有 `OrderService.refund()` 已实现「先落退款单、再调渠道、成功才动本地账」，本轮只把渠道配置来源从环境变量换成版本化配置 |
| 会员套餐并入充值商品 | 会员是周期权益，不是一次性积分；继续留在 `/admin/membership-plans` |
| 发票域 | 独立模块，不随本次支付重构调整 |

---

## 2. 现状审计

### 2.1 当前链路

```
OrderService.create()                订单快照 + 优惠 + 幂等键
  └─ PaymentsService.createIntent()  取「唯一生效通道」预下单
       └─ PaymentProviderFactory.active()  读 PAYMENT_PROVIDER + 环境变量凭据
  └─ POST /payments/callback/:channel  验签 → 金额核对 → OrderService.markPaid()
       └─ 差异写 ReconciliationBatch(fileName='(callback)') + ReconciliationItem
  └─ GET /payments/:orderId/status     轮询本地 Payment 流水
```

关键实现：

| 位置 | 现状 |
| --- | --- |
| `backend/src/payments/payment-provider.interface.ts:15` | 通道白名单硬编码 `sandbox / alipay / wechat` |
| `backend/src/payments/payment.factory.ts:65` | `active()` 只取环境变量声明的**单一**通道；缺凭据 503 |
| `backend/src/payments/payment.factory.ts:82` | `byChannel()` 用于回调，按 URL 通道选实现 |
| `backend/src/payments/payments.service.ts:51` | 建意图时只取 `factory.active()`，不接受渠道参数 |
| `backend/src/payments/payments.service.ts:173` | 回调同步处理，无持久化收件箱、无重试队列 |
| `backend/src/payments/payments.service.ts:268` | 差异写旧 `ReconciliationBatch/Item` |
| `backend/src/orders/order.service.ts:444` | `markPaid()` 是唯一入账路径，已处理积分、会员、券、通知 |
| `backend/src/orders/order.service.ts:998` | `cancelExpired()` 只改本地状态，不向渠道查单/关单 |
| `backend/src/admin/reconciliation.service.ts:41` | 对账依赖人工上传 CSV；无渠道账单下载、无自动补发 |
| `backend/src/admin/payment-channels.controller.ts:31` | 支付渠道页只读，凭据来自环境变量 |
| `frontend/src/pages/admin/AdminPaymentChannelsPage.tsx:60` | 只读状态页 |
| `frontend/src/pages/admin/AdminReconciliationPage.tsx:88` | 批次导入 + 差异处置 |
| `backend/prisma/schema.prisma:177` | `Order` 同时承载商品单与会员单 |
| `backend/prisma/schema.prisma:271` | `Payment` 是支付流水，`payTransactionId` 唯一 |
| `backend/prisma/schema.prisma:1125` | 旧对账批次表 |

### 2.2 缺口

1. 同一时间只能有一个生效通道；用户无法选择支付方式。
2. 渠道凭据只能改环境变量并重启，后台不能维护；参考页的「配置渠道」能力缺失。
3. 没有查单/关单动作，订单只能等回调或超时本地取消。
4. 回调同步落库，数据库短暂不可用时渠道重试可能丢单；无重试队列。
5. 对账靠人工导 CSV，不能自动发现「渠道已支付、本地未入账」并补发。
6. 商品模型没有币种、上架策略（周期/库存/限时）、库存占用。

---

## 3. 与参考实现的对照

| 参考实现 | 本方案 | 理由 |
| --- | --- | --- |
| Go RPC 支付插件（`plugin-packages/official-payment-*`） | NestJS `PaymentAdapter` 内置注册表 | 本仓库没有 Go 插件运行时；模型层插件是 manifest + 协议执行器，支付无需为一个适配器引入二进制插件 |
| 独立 `PaymentOrder` 表 | 复用现有 `Order`，扩展支付编排字段 | 本仓库 `Order` 已统一承载商品单/会员单/优惠/积分快照；再建 `PaymentOrder` 会形成两套订单与两套幂等 |
| `PaymentProviderConfig` 版本化加密配置 | 采用 | 密钥轮换后旧回调仍可验签；后台可审计 |
| `PaymentNotification` 持久化收件箱 | 采用 | 回调可靠性是当前最大缺口 |
| `queryOrder / closeOrder` | 采用 | 后台运维必需 |
| `DownloadTradeBill` + T+1 自动对账 + 自动补发 | 采用（支付宝/微信）；CSV 导入保留为兜底 | 参考实现已有成熟语义；旧 CSV 能力不能丢 |
| `TopupProduct` 独立表 | 扩展现有 `Product` | 避免与 `/admin/products`、C 端 `/products` 形成两套商品源 |
| storage 商品 | 暂不做 | 缺少配额子系统 |
| antd 组件 | BoardUI 等价件 | 仓库硬约束：后台不引 antd |

---

## 4. 目标架构

```
Admin /payments 四标签
  ├─ 支付渠道  → PaymentProviderConfigService（版本化、加密）
  ├─ 充值商品  → AdminCommerceService（扩展 Product）
  ├─ 支付订单  → PaymentOrderService（查单/关单/导出）
  └─ 支付对账  → PaymentReconciliationService（渠道账单 / CSV / 自动补发）

C 端结算
  GET  /payments/providers                 可选渠道
  POST /payments/:orderId/intent           指定渠道预下单
  GET  /payments/:orderId/status           本地状态轮询（stale 时触发查单）

回调
  POST /payments/callback/:providerId/:configId
       → 验签 → 写 PaymentNotification（唯一 eventId）
       → 立即尝试入账；失败交给 worker 退避重试

Worker（进程内，随调度器启动）
  · 每 15s 消费通知收件箱
  · 每 15s 关闭过期订单 / 补查 pending 订单
  · 每 30min 尝试 T+1 对账（10:15 后，最近三个月）
```

### 4.1 分层职责

| 层 | 职责 | 不做什么 |
| --- | --- | --- |
| `PaymentsController` | HTTP 入参、公开回调、原始报文 | 不改订单状态 |
| `PaymentsService` | 建意图、验签编排、收件箱、查单/关单编排 | 不直接发积分 |
| `PaymentAdapter` | 单个渠道协议：下单/查单/关单/验签/账单/退款 | 不知道订单与积分 |
| `PaymentProviderConfigService` | 配置版本、加密、解密、启停、字段元数据 | 不发起支付 |
| `OrderService` | 订单状态机、`markPaid()` 唯一入账路径、退款 | 不拼渠道协议 |
| `PaymentReconciliationService` | 账单比对、二次查单确认、补发调用 | 不直接改钱；补发仍走 `markPaid()` |
| `PaymentWorker` | 收件箱重试、过期关单、补查、每日对账 | 不做业务判定 |

### 4.2 渠道注册表

新增 `backend/src/payments/adapters/`：

```
adapters/
├── payment-adapter.interface.ts   # 描述符、配置字段、下单/查单/关单/验签/账单
├── sandbox.adapter.ts
├── alipay.adapter.ts
├── wechat.adapter.ts
└── index.ts                       # PAYMENT_ADAPTERS 数组
```

适配器描述符：

```ts
interface PaymentAdapterDescriptor {
  id: string;                       // 'alipay' | 'wechat' | 'sandbox'
  name: string;                     // 后台展示名
  checkoutMode: 'redirect' | 'qrcode' | 'sandbox';
  /** 后台配置表单的字段元数据；前端不写死渠道字段 */
  configFields: PaymentConfigField[];
  /** 是否支持渠道账单下载（对账） */
  supportsReconciliation: boolean;
}
```

`PaymentAdapter` 方法：

```ts
validateConfig(values: Record<string, string>): string[];
createOrder(input: CreateOrderInput): Promise<Checkout>;
queryOrder(input: QueryOrderInput): Promise<ProviderResult>;
closeOrder(input: CloseOrderInput): Promise<ProviderResult>;
verifyNotification(input: NotificationInput): Promise<NotificationResult>;
ack(result: NotificationResult): PaymentAck;
downloadTradeBill?(billDate: string): Promise<BillRecord[]>;
refund(input: RefundInput): Promise<RefundResult>;   // 复用现有 channel 适配逻辑
```

约束：

- 适配器**不读 `process.env`**，所有凭据由调用方传入解密后的 `values`。
- 缺字段由 `validateConfig` 返回字段名，调用方转 `50301`，**绝不降级为沙箱**。
- 渠道白名单只在注册表定义；新增渠道只加一个文件与数组项。

### 4.3 配置版本

`PaymentProviderConfig` 不可变：每次保存新增一版，`(providerId, version)` 唯一。订单在下单时固定 `providerConfigId / providerConfigVersion / providerId`，后续渠道改密钥不影响旧订单的验签与查单。

保存流程：

1. 校验 `enabled`、`closeAfterMinutes`（5–1440）、字段必填与格式。
2. 合并旧值：前端未提交的密钥字段沿用当前版本密文（参考页的「已配置」占位语义）。
3. 对 `secret=true` 字段加密（AES-256-GCM），非密钥字段可明文保存在同一 JSON 中再整体加密。
4. 新版本 `version = max(version) + 1`；写审计（`payment.config_write`）。
5. 读取时解密并只回传非密钥字段；密钥字段回 `secretConfigured: true` 与掩码，不回传明文。

密钥加密复用 `backend/src/model/infra/secret-cipher.ts:31` 的 `SecretCipher`。为避免模型域与支付域互相依赖，把 `SecretCipher` 抽到 `common/security/` 并做成全局模块；`MODEL_SECRET_KEY` 语义保持不变（生产必须显式配置），文档与 `.env.example` 补一句「模型与支付凭证共用该密钥，轮换会使两者密文同时失效」。

### 4.4 订单与支付尝试

不在 `Order` 之外新建 `PaymentOrder`。在 `Order` 上增加支付编排字段，在 `Payment` 上增加「尝试」语义：

- 一个 `Order` 同一时刻只有一个进行中的支付意图；重复发起意图复用同一 `orderNo` 与配置版本。
- `Payment` 每次发起支付一条 `pending` 流水；回调/查单成功后更新为 `succeeded`，关单后更新为 `closed`，渠道下单失败更新为 `failed` 并写 `message`。
- `payTransactionId` 保持唯一，继续作为重复回调去重键。
- 入账仍只走 `OrderService.markPaid()`；`markPaid` 增加 `providerTradeNo` 幂等与金额/币种核对入参。

状态展示：

| 页面状态 | 判定 | 文案 |
| --- | --- | --- |
| `pending` | `Order.status='pending'` 且无失败尝试 | 待支付 |
| `closing` | `Order.status='pending'` 且 `closeStartedAt` 在 2 分钟内 | 关单中 |
| `closed` | `Order.status='cancelled'` | 已关闭 |
| `credited` | `Order.status='paid'` | 已入账 |
| `create_failed` | `Order.status='pending'` 且最近一次 `Payment.status='failed'` | 下单失败 |
| `refunded` / `partial_refunded` | 订单退款状态 | 已退款 / 部分退款 |

不把 `closing / create_failed` 写进 `Order.status` 状态机，避免触碰订单导出、告警、C 端订单页与 `TRANSITIONS` 的既有白名单；它们作为**派生状态**只出现在支付后台视图与筛选中。

### 4.5 回调收件箱与 worker

回调路径：

1. 校验 `providerId + configId` 存在，解密该版本配置。
2. 适配器验签；失败直接回渠道失败响应，不落库。
3. 归一出 `merchantOrderNo / providerTradeNo / amountCents / currency / paid / closed / paidAt / providerStatus / eventId`。
4. 按 `merchantOrderNo` 查订单；订单不存在或配置版本不匹配 → 落 `failed` 收件箱 + 对账差异，回渠道失败（让其重试）。
5. 以 `(providerId, eventId)` 唯一写入 `PaymentNotification`（原始报文加密、摘要落库）。重复事件直接回成功。
6. 立即尝试处理；失败则保留 `pending`，由 worker 按指数退避重试。
7. 渠道应答格式由适配器 `ack()` 决定（支付宝纯文本 / 微信 JSON）。

证据不符的终态：

| 情况 | 处理 | 应答 |
| --- | --- | --- |
| 验签失败 | 不落库，日志告警 | 失败 |
| 订单不存在 | 收件箱 `failed` + 对账差异 | 失败（渠道重试，人工核对） |
| 配置版本不匹配 | 收件箱 `failed` + 告警 | 失败 |
| 金额/币种不符 | 收件箱 `failed` + 对账差异 | 失败（不做本地入账） |
| 订单已入账 | 幂等确认，不改状态 | 成功 |
| 订单已关闭但收到成功回调 | 对账差异 + 告警 | 失败 |

worker 与调度器：

- 不新增长期驻留的 `setInterval`；复用 `backend/src/admin/scheduler.service.ts` 的 `tick()` 机制，新增任务键：
  - `payment-notification-drain`：每 15s，最多 32 条，退避重试。
  - `payment-order-reconcile`：每 15s，过期订单查单后关单；pending 订单超过 30s 未查则补查。
  - `payment-daily-reconciliation`：每 30min 检查，10:15 后只跑昨日账单，按 `(providerId, billDate)` 唯一且失败 30 分钟内不重试。
- 多实例部署时 worker 会各自抢任务；用 `PaymentNotification.status + nextAttemptAt` 条件更新与唯一约束保证不重复入账。当前单机 SQLite 部署可直接串行。

### 4.6 对账

新增 `PaymentReconciliationRun / Item`，替代旧 `ReconciliationBatch / Item`：

- `run` 唯一键 `(providerId, billDate)`，状态 `running / completed / failed`。
- `source = 'provider' | 'csv'`：渠道账单下载为主，CSV 导入保留给不支持账单下载的渠道。
- 比对结果：
  - `matched`：账单有、本地已入账、金额与交易号一致。
  - `recovered`：账单有、本地未入账，**签名查单确认已支付且金额/交易号一致**后自动入账并补发权益。
  - `local_order_not_found`：账单有、本地订单不存在。
  - `provider_record_missing`：本地已入账、账单无记录。
  - `amount_mismatch`：金额或币种不一致。
  - `trade_no_mismatch`：交易号不一致。
  - `credit_failed`：确认已支付但补发失败（重试或人工）。
- **账单只是线索，不是入账授权**：任何自动补发前必须调用适配器 `queryOrder()` 并校验 `paid / amount / currency / tradeNo`。
- 处置不改钱：`resolved` 只标记，补发失败的人工处理仍回订单流程。
- 旧的 `ReconciliationBatch/Item` 在 Phase 3 完成后删除；告警中心、值班带、导航中的 `/admin/reconciliation` 链接同步改到 `/admin/payments?tab=reconciliation`。

---

## 5. 数据模型变更（Prisma）

> SQLite；不新增 enum，状态继续 `String` + service 白名单。

### 5.1 新增 `PaymentProviderConfig`

```prisma
model PaymentProviderConfig {
  id                String   @id @default(cuid())
  providerId        String
  version           Int
  enabled           Boolean  @default(false)
  closeAfterMinutes Int      @default(30)
  /// AES-256-GCM 密文，内容为配置字段 JSON（含密钥）
  configCipher      String   @default("")
  /// 配置摘要（sha256），用于判断是否与上一版不同
  configDigest      String   @default("")
  createdBy         String?
  createdAt         DateTime @default(now())

  @@unique([providerId, version])
  @@index([providerId, createdAt])
}
```

### 5.2 扩展 `Order`

```prisma
  /// 支付渠道 = 适配器 id（sandbox / alipay / wechat）
  /// 现有 channel 字段继续使用，不再新增 providerId
  providerConfigId      String?
  providerConfigVersion Int?
  providerTradeNo       String?   @unique
  providerStatus        String?
  checkoutMode          String?
  /// 二维码载荷或跳转地址；只对当前进行中的意图有效
  checkoutValue         String?
  checkoutExpiresAt     DateTime?
  lastQueriedAt         DateTime?
  lastError             String?
  closeStartedAt        DateTime?
  closedAt              DateTime?
  /// 库存占用（inventory 商品）；支付/取消时释放
  stockReserved         Boolean   @default(false)
```

### 5.3 扩展 `Payment`

```prisma
  providerConfigId      String?
  providerConfigVersion Int?
  providerStatus        String?
  /// 'pending' | 'succeeded' | 'failed' | 'closed'
  /// 现有 status 已含这四个值，补索引与语义即可
  lastError             String?
  closedAt              DateTime?
```

### 5.4 新增 `PaymentNotification`

```prisma
model PaymentNotification {
  id               String   @id @default(cuid())
  providerId       String
  providerEventId  String
  providerConfigId String
  merchantOrderNo  String
  orderId          String?
  payloadDigest    String
  /// 验签通过的原始报文密文
  payloadCipher    String   @default("")
  normalizedJson   String   @default("{}")
  /// 'pending' | 'processed' | 'failed'
  status           String   @default("pending")
  attempts         Int      @default(0)
  lastError        String?
  nextAttemptAt    DateTime @default(now())
  processedAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([providerId, providerEventId])
  @@index([status, nextAttemptAt])
  @@index([merchantOrderNo])
}
```

### 5.5 新增对账表

```prisma
model PaymentReconciliationRun {
  id             String   @id @default(cuid())
  providerId     String
  configId       String?
  billDate       String
  /// 'provider' | 'csv'
  source         String   @default("provider")
  fileName       String?
  /// 'running' | 'completed' | 'failed'
  status         String   @default("running")
  totalItems     Int      @default(0)
  matchItems     Int      @default(0)
  recoveredItems Int      @default(0)
  errorItems     Int      @default(0)
  error          String?
  startedBy      String?
  startedAt      DateTime @default(now())
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  items PaymentReconciliationItem[]

  @@unique([providerId, billDate])
  @@index([status, createdAt])
}

model PaymentReconciliationItem {
  id              String   @id @default(cuid())
  runId           String
  providerId      String
  orderId         String?
  merchantOrderNo String
  providerTradeNo String?
  amountCents     Int
  currency        String   @default("CNY")
  /// matched | recovered | local_order_not_found | provider_record_missing
  /// | amount_mismatch | trade_no_mismatch | credit_failed
  result          String
  resolved        Boolean  @default(false)
  detail          String?
  createdAt       DateTime @default(now())

  run PaymentReconciliationRun @relation(fields: [runId], references: [id])

  @@unique([runId, merchantOrderNo])
  @@index([result])
}
```

### 5.6 扩展 `Product`

```prisma
  /// 'CNY' | 'USD'
  currency            String  @default("CNY")
  /// 'credits' | 'storage'（storage 仅 Phase 5 启用）
  kind                String  @default("credits")
  storageBytes        BigInt  @default(0)
  storageDurationDays Int     @default(0)
  /// unlimited | periodic | inventory | timed
  saleStrategy        String  @default("unlimited")
  periodDays          Int     @default(0)
  periodPurchaseLimit Int     @default(0)
  stockTotal          Int     @default(0)
  stockReserved       Int     @default(0)
  stockSold           Int     @default(0)
  saleStartAt         DateTime?
  saleEndAt           DateTime?
```

说明：

- 保留现有 `credits`（整数积分）与 `creditsValidDays`，不改成微积分，避免影响 C 端商品接口与积分发放。
- `type` 字段保留兼容旧数据；新逻辑以 `kind` 为准。

### 5.7 站点设置

`backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` 增加：

- `payment.defaultCurrency`：默认 `CNY`，可选 `CNY / USD`。

---

## 6. 接口契约

### 6.1 C 端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/payments/providers` | 可用渠道（`enabled && configured`），返回 `id / name / checkoutMode / icon` |
| POST | `/payments/:orderId/intent` | Body `{ providerId }`；下单并固定配置版本；返回 `mode / value / url / expiresAt` |
| GET | `/payments/:orderId/status` | 本地状态；`pending` 且 `lastQueriedAt` 超过 2s 时触发一次渠道查单 |
| POST | `/payments/:orderId/query` | 主动查单（前端「刷新支付状态」） |
| POST | `/orders/:orderId/cancel` | 未支付取消；已固定渠道时先查单再关单，渠道已支付则转已支付并返回 409 提示 |

`POST /orders` 不变（商品/会员、优惠、幂等键）。`intent` 的 `providerId` 在只有一个可用渠道时可省略，由服务端取唯一可用项。

### 6.2 后台

统一前缀 `/api/v1/admin/payments`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/providers` | `payment.read` | 渠道列表 + 当前配置版本 + 字段元数据 + `secretConfigured` |
| PUT | `/providers/:id/config` | `payment.write` | 保存新版本；高危审计 |
| GET | `/settings` | `payment.read` | 默认充值货币 |
| PUT | `/settings` | `payment.write` | 修改默认货币 |
| GET | `/products` | `product.read` | 充值商品列表（含上架状态计算） |
| POST | `/products` | `product.write` | 新建商品 |
| PUT | `/products/:id` | `product.write` | 修改商品 |
| GET | `/orders` | `order.read` | 支付订单分页：`status / keyword / providerId / timeField / from / to / page / pageSize` |
| GET | `/orders/export.csv` | `data.export` | 同筛选导出，上限 10000 |
| POST | `/orders/:id/query` | `payment.operate` | 向渠道查单并应用结果 |
| POST | `/orders/:id/close` | `payment.operate` | 先查单，已支付则入账；否则关单 |
| POST | `/reconciliations` | `finance.reconcile` | `{ providerId, billDate }`；唯一键冲突返回已有 run |
| GET | `/reconciliations` | `payment.read` | 运行列表：`providerId / status / from / to / page / pageSize` |
| GET | `/reconciliations/:id/items` | `payment.read` | 明细：`result / page / pageSize` |
| GET | `/reconciliations/export.csv` | `data.export` | 汇总导出 |
| GET | `/reconciliations/:id/items/export.csv` | `data.export` | 明细导出 |
| POST | `/reconciliations/import` | `finance.reconcile` | CSV 兜底导入（复用旧解析规则） |

新增权限点（`backend/src/admin/permissions.ts`）：

- `payment.write`：支付渠道配置写入；加入 `HIGH_RISK_PERMISSIONS`。
- `payment.operate`：查单/关单；授予 `admin / finance`，运营只读。
- `payment.read` 继续用于所有读取。

说明：商品复用现有 `/admin/products` 服务与 DTO，新增字段后同步扩展 `ProductCreateDto / ProductUpdateDto`；不另建一套 `TopupProduct` API，避免同一商品两个写入入口。支付后台的 `/admin/payments/products` 仅作为页面聚合入口，内部调用同一 service。

---

## 7. 后台页面规格：`/admin/payments`

页面使用 `components/admin/PageHeader`、`Panel`、`admin-ui/primitives/DataTable`、`Drawer`、`Descriptions`、`controls`、`vendor/boardui` 的 `Tabs`。不引用 antd。

### 7.1 页面骨架

- 标题：支付充值
- 描述：管理系统支付适配器、充值商品、支付订单与 T+1 对账
- 右上角：刷新（按当前标签页重载）
- 顶部提示条：平台不提供支付退款；管理端只做查单、关单、对账；关单前先查单，对账发现已支付未入账时幂等补发。
- 四个标签：`支付渠道` / `充值商品` / `支付订单` / `支付对账`
- URL 同步：`?tab=providers|products|orders|reconciliation`，默认 `providers`；告警深链可直达。

### 7.2 支付渠道标签

表格列：

| 列 | 内容 |
| --- | --- |
| 支付渠道 | 渠道图标 + 名称 + `providerId` 等宽小字 |
| 支付方式 | 扫码支付 / 网站跳转 / 站内模拟 |
| 状态 | 可用/不可用；副行「配置已启用/已停用」 |
| 未支付自动关闭 | `closeAfterMinutes` 分钟 |
| 配置版本 | `v{version}` / 未配置 |
| 操作 | 配置 |

配置抽屉：

- 渠道启用 Switch。
- 未支付自动关闭时间 InputNumber（5–1440，整数）。
- 动态字段：由后端 `configFields` 渲染；`type=password` 或 `secret=true` 用密码框，已配置时占位「已配置，留空保持不变」；`textarea` 支持多行；`values` 提供下拉选项。
- 保存：`PUT /providers/:id/config`，成功提示「已保存为新版本」并重载列表。
- 密钥字段永不回显明文；保存时未填的密钥沿用上一版。
- 页脚提示：密钥加密保存；历史订单固定使用下单时的配置版本。

### 7.3 充值商品标签

工具栏：

- 左侧：默认充值货币下拉（CNY / USD），保存到 `payment.defaultCurrency`。
- 右侧：新增商品。

表格列：

| 列 | 内容 |
| --- | --- |
| 商品 | 名称 + 说明 |
| 售价 | `¥12.00` / `$12.00`（按币种格式化） |
| 权益 | `+100 积分`（Phase 5 后支持 `+50 GB · 30 天`） |
| 排序 | `sortOrder` |
| 上架策略 | 不限量 / 周期 N 天 M 次 / 库存 剩余/总量 / 限时（待发售/进行中/已结束） |
| 状态 | 已停用 / 待发售 / 已结束 / 已售罄 / 销售中 |
| 操作 | 编辑 |

编辑抽屉字段：

- 名称、说明、类型（credits；storage 在 Phase 5 前禁用）、币种、售价（元/美元）、到账积分、积分有效期、上架策略及其参数、排序、上架销售。
- 类型创建后不可改；改类型需新建商品。
- 库存编辑不能低于已售；未支付订单占用库存，取消/超时释放。
- 价格与积分必须为正整数/合法小数（与现有 DTO 校验一致）。

### 7.4 支付订单标签

工具栏：

- 搜索：名称、用户名、邮箱、订单号、渠道交易号、完整用户 ID。
- 筛选：订单状态、支付渠道、时间口径（创建/支付/入账）、日期范围（北京时间，含当天）。
- 查询按钮；筛选变更后提示「请先查询以应用筛选条件」。
- 导出 CSV（同筛选，最多 10000 行）。

表格列：

| 列 | 内容 |
| --- | --- |
| 用户 | 昵称 + 用户名 + 邮箱；用户不存在时显示用户 ID 片段 |
| 订单/商品 | 订单号（可复制）+ 商品名 |
| 渠道 | 渠道图标 + 名称 |
| 金额/权益 | 金额 + 权益文案 |
| 状态 | 待支付 / 关单中 / 已关闭 / 已入账 / 下单失败 / 已退款 |
| 创建时间 | `MM-DD HH:mm`，悬停显示完整时间 |
| 操作 | 详情；未支付/失败显示「同步状态」「关闭」 |

详情抽屉：

- 用户、邮箱、用户 ID（可复制）、订单号（可复制）、渠道交易号、商品、渠道、金额/权益、状态。
- 时间线：创建、过期、支付、入账、关闭。
- 操作：同步状态、关闭（确认文案：系统会先查单，渠道已支付则立即入账，否则关单）。

分页：页码 + 每页条数（默认 30）。

### 7.5 支付对账标签

顶部执行区：

- 渠道下拉（仅已配置渠道；未配置禁用）。
- 账单日期（不能选今天及以后，最多回溯 3 个月）。
- 执行对账按钮。
- 说明：系统每天 10:15 后自动对账昨日账单；也可手动重跑最近三个月。

运行列表：

| 列 | 内容 |
| --- | --- |
| 账单日期 | `YYYY-MM-DD` |
| 渠道 | 渠道图标 + 名称 |
| 状态 | 已完成 / 执行中 / 失败 |
| 一致 | `matchItems` |
| 自动补发 | `recoveredItems`（有值时高亮） |
| 异常 | `errorItems`（有值时高亮） |
| 完成时间 | 完整时间 |
| 明细 | 查看 |

明细抽屉：

- 结果筛选（全部 / 仅异常 / 具体结果）。
- 列：结果、商户订单号（等宽）、渠道交易号、金额、说明。
- 导出明细 CSV（仅完成后可用）。
- 失败 run 显示错误原因提示条。

分页：运行列表与明细各自分页。

### 7.6 导航与旧页处理（待确认）

推荐：

- 「财务」组新增 `{ path: '/admin/payments', label: '支付充值', permission: 'payment.read' }`。
- 移除 `/admin/payment-channels` 与 `/admin/reconciliation` 两个导航项；旧路由重定向到 `/admin/payments?tab=...`，避免书签与告警深链 404。
- `/admin/products` 与 `/admin/orders` 保留：前者仍是全量商品管理，后者是订单/退款/核销的客服视角；支付充值页的商品与订单标签聚焦「充值」口径，互相加「完整管理」链接。
- 告警中心、值班带、后台搜索中的 `reconciliation` 链接改到新地址。

备选：保留旧页，仅新增 `/admin/payments`。缺点是同一份渠道状态与对账数据两套入口、两套维护。

---

## 8. C 端改动

| 页面/模块 | 改动 |
| --- | --- |
| `frontend/src/pages/CheckoutPage.tsx` | 结算页加载可用渠道；多渠道时让用户选择；单渠道自动选中。发起支付传 `providerId` |
| 沙箱提示 | 保留「沙箱不产生真实扣款」的明示；沙箱仅开发/测试可用 |
| 二维码 | `mode=qrcode` 继续用 `qrcode` 库渲染；`redirect` 打开渠道收银台 |
| 轮询 | `status` 轮询到 `paid` 跳成功；过期显示重新发起；失败如实展示渠道文案 |
| `frontend/src/pages/OrdersPage.tsx` | 「继续支付」带上已固定渠道；订单状态文案补「关单中」等派生状态 |
| `frontend/src/pages/PackagesPage.tsx` | 商品卡支持币种、售罄、待发售、限时；库存/周期不可购买时禁用按钮并说明原因 |

C 端接口仍走现有 `frontend/src/lib/api.ts` 的 `paymentsApi`，新增 `providers()`、`intent(orderId, providerId)`、`query(orderId)`。

---

## 9. 关键规则

### 9.1 幂等

- 下单：`@@unique([userId, idempotencyKey])` 不变。
- 回调：`Payment.payTransactionId` 唯一；`PaymentNotification (providerId, eventId)` 唯一。
- 入账：`markPaid()` 先查交易号、再判订单状态，重复通知不重复发积分。
- 对账补发：同一 `(runId, merchantOrderNo)` 唯一；补发仍走 `markPaid()`，天然幂等。

### 9.2 金额与币种

- 订单金额以 `Order.paidCents` 快照为准；回调金额必须相等，币种必须相等。
- 商品币种来自 `Product.currency`；订单落 `Order.currency`（新增字段，默认 CNY）。
- 渠道不支持订单币种时，下单前拒绝（`400`），不把美元单发给只收人民币的通道。

### 9.3 查单与关单

关单顺序不可反：

1. 向渠道查单。
2. 已支付 → 走 `applyPaymentResult` 入账；已关闭 → 本地关闭；未支付 → 调渠道关单。
3. 关单失败后再查一次：支付可能恰好在查单与关单之间完成。
4. 两次都查不到且渠道返回「订单不存在」→ 本地关闭。
5. 其他失败 → 保持 `pending`，写 `lastError`，由 worker 重试；**不本地关闭**。

过期订单同理：先查单再关单，不直接 `cancelled`。

### 9.4 对账补发

- 渠道账单中出现但本地未入账的订单，必须先 `queryOrder()` 确认 `paid=true`、金额/币种/交易号一致，再调用 `markPaid()`。
- 确认失败 → `credit_failed`，不补发。
- 补发失败 → `credit_failed`，保留明细，人工重试。
- 对账只改对账状态，不改订单/积分；补发是调用订单入账路径，不是直接写积分。

### 9.5 商品上架

- `unlimited`：默认可购买。
- `periodic`：按 `(userId, productId, createdAt)` 统计周期内已支付订单数，达到 `periodPurchaseLimit` 拒绝。
- `inventory`：下单时条件更新 `stockReserved += 1`（不超过 `stockTotal - stockSold`）；支付成功 `stockReserved -= 1, stockSold += 1`；取消/超时 `stockReserved -= 1`。
- `timed`：`now` 必须落在 `[saleStartAt, saleEndAt]`；未开始显示「待发售」，结束显示「已结束」。
- 商品下架不影响历史订单与已发积分。

### 9.6 安全

- 渠道密钥只以密文落库；接口永不回传明文。
- 支付配置写入、关单、对账补发全部写审计。
- 公开回调不挂 JWT，只信验签；原始报文必须用 `rawBody`（`main.ts` 已开启）。
- 后台权限校验必须在后端；前端 `can()` 只隐藏按钮。
- 生产环境沙箱通道强制不可用：即使配置启用，`activeProviders()` 也过滤，避免「支付成功但没收到钱」。

---

## 10. 实施批次

### Phase 0：基础

- `SecretCipher` 抽到 `common/security/` 并全局提供。
- 新增 `PaymentProviderConfig`、`PaymentNotification` 表。
- 新增 `PaymentAdapter` 接口与 `PAYMENT_ADAPTERS` 注册表；沙箱适配器先迁移。
- 保留旧 `PaymentsService` 可运行，新增能力并行开发。

### Phase 1：渠道配置 + 支付渠道标签

- `PaymentProviderConfigService`（版本、加密、字段元数据、启停）。
- 支付宝/微信适配器改为接收配置对象，不再读环境变量。
- 新增 `/admin/payments/providers` 读写接口与页面标签。
- C 端 `GET /payments/providers`；`intent` 接受 `providerId`；多渠道选择。
- 移除 `PAYMENT_PROVIDER / ALIPAY_* / WECHAT_*` 的启动期必填校验（保留 `PAYMENT_NOTIFY_BASE` 或改为配置项 `publicBaseUrl`）。生产环境必须先在后台配置渠道。

### Phase 2：查单/关单 + 订单标签

- `Order` 支付编排字段、`Payment` 尝试字段、`currency`。
- `queryOrder / closeOrder / applyPaymentResult`。
- 回调收件箱与 worker（通知消费、过期查单关单、pending 补查）。
- `/admin/payments/orders` 列表/详情/查单/关单/导出。
- 页面「支付订单」标签与详情抽屉。
- 调度器新增任务键与手动触发。

### Phase 3：对账

- `PaymentReconciliationRun / Item`、渠道账单下载（支付宝/微信）、CSV 兜底。
- 对账比对、二次查单确认、自动补发。
- 每日 10:15 自动对账与失败重试。
- 页面「支付对账」标签。
- 旧 `ReconciliationBatch / Item`、旧页面、旧告警链接下线；导航调整。

### Phase 4：商品增强 + 页面收口

- `Product` 扩展币种、上架策略、库存、限时字段。
- `ProductCreateDto / ProductUpdateDto`、`AdminCommerceService`、C 端商品卡同步。
- 页面「充值商品」标签与默认货币设置。
- `/admin/payments` 四标签完整对齐参考页；旧路由重定向。

### Phase 5（可选）：存储商品与聚合渠道

- 存储配额：`StorageGrant`、容量计算、上传校验。
- 易支付/虎皮椒/支付FM 适配器与账单下载。

---

## 11. 测试计划

### 11.1 单元

- 配置加密/解密、密钥字段留空沿用旧值、版本自增。
- 金额/币种核对、重复回调幂等、订单状态机不可跳跃。
- 关单顺序：查单已支付 → 入账；查单未支付 → 关单；关单失败 → 再查一次。
- 商品上架策略：周期次数、库存占用/释放、限时窗口。
- 对账：`matched / recovered / amount_mismatch / trade_no_mismatch / credit_failed / local_order_not_found / provider_record_missing`。
- 对账补发必须经过签名查单；查单未确认不补发。

### 11.2 集成

- 本地 mock 渠道服务：支付宝 RSA2 表单、微信 v3 签名与 AES-GCM 回调解密。
- 回调重复、乱序、验签失败、金额不符、订单不存在。
- 收件箱重试：第一次入账失败后 worker 重试成功；重复事件不重复发积分。
- 进程重启后 pending 通知仍能入账。
- 数据库短暂不可用时回调不丢（收件箱落库失败则回渠道失败，渠道重试）。

### 11.3 前端

- `/admin/payments` 四标签渲染、URL `tab` 同步。
- 渠道配置抽屉：动态字段、密钥占位、保存新版本。
- 商品新建/编辑、库存不足提示、限时状态。
- 订单筛选/分页/导出/详情/查单/关单。
- 对账执行、运行列表、明细筛选、导出、失败原因展示。
- 权限：无 `payment.write` 不显示保存；无 `finance.reconcile` 不显示执行对账（后端仍校验）。

### 11.4 闸口

- `npm run check`（根目录）。
- `npm run verify:deps:critical`（本轮不新增依赖）。
- `cd backend && npm run build && node dist/main.js` 启动检查。
- 相关 smoke：`smoke-payments.js`、`smoke-commerce.js`、`smoke-admin.js`（按 `docs/testing.md` 的前置执行）。
- 新增 `scripts/verify-payment-config.ts`、`scripts/smoke-payment-reconciliation.js`（Phase 1/3 各自补）。

---

## 12. 风险与取舍

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 凭据从环境变量迁到数据库 | 部署方式变化；生产首次启动无渠道可用 | 生产门禁提示「至少配置一个支付渠道」；文档与 `.env.example` 同步；后台显式告警 |
| 加密密钥丢失 | 所有渠道配置不可解密 | 密钥与数据库同备份；轮换需重新录入；启动日志不打印密钥 |
| SQLite 并发 | 库存占用、收件箱抢任务可能冲突 | 事务 + 条件更新 + 唯一约束；单机 worker 串行；多实例前先评估 |
| 渠道账单 API 权限/公网 | 对账失败 | run 落 `failed` 与安全错误码；30 分钟后重试；保留 CSV 兜底 |
| 旧页面/链接下线 | 书签、告警深链 404 | 旧路由重定向；告警与值班带链接同步修改 |
| 订单派生状态 | 与旧订单页文案不一致 | 旧订单页补文案；状态映射集中在一个 `paymentStatusMeta` 工具 |
| 支付宝/微信协议细节 | 查单/关单/账单字段差异 | 适配器隔离；mock 契约测试；错误码不透传凭据 |
| 存储商品缺配额 | 卖了容量但不限流 | 本轮不做；Phase 5 与配额子系统一起上线 |

---

## 13. 待确认

以下四项决定实现范围，建议按推荐项执行：

1. **渠道配置存储**：数据库托管、加密、版本化（推荐）／保持环境变量只读。前者才能复刻参考页的「配置渠道」。
2. **页面归属**：新增 `/admin/payments` 并下线 `/admin/payment-channels`、`/admin/reconciliation`（推荐，旧路由重定向）／新增页面同时保留旧页。
3. **商品范围**：本轮仅积分商品，扩展币种/上架策略/库存/限时（推荐）／同时做存储扩容（需先建配额子系统）。
4. **渠道范围**：支付宝 + 微信 + 沙箱（推荐）／同时接易支付等聚合通道（工作量约翻倍）。

确认后按 Phase 0 → 4 推进；每批完成后给 `file:line` 摘要与真实闸口结果。
