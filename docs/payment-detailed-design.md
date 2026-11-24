# 支付域详细设计（后端契约）

> 状态：2026-11 支付域重构的后端实现规格。主链路已落地；与代码冲突时以代码为准。
> 设计目标与决策见 [`payment-refactor-design.md`](payment-refactor-design.md)，后台页面与前端实现见 [`payment-ui-design.md`](payment-ui-design.md)。
> 章节号已按本文重排；拆分前的原始编号不再保留。

## 1. 数据模型（Prisma）

> SQLite；不新增 enum，状态继续 `String` + service 白名单。新增字段一律可空或有默认值，可直接随一次 Prisma 迁移升级（当时为 `db push`，现已改为 `prisma migrate deploy`，见 [`payment-refactor-design.md`](payment-refactor-design.md) §7.1）。

### 1.1 新增 `PaymentProviderConfig`

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

### 1.2 扩展 `Order`

```prisma
  /// 订单币种；金额字段是最小单位（CNY 分 / USD 美分）
  currency              String   @default("CNY")
  /// 支付渠道 = 适配器 id（sandbox / alipay / wechat）；沿用现有 channel 字段
  providerConfigId      String?
  providerConfigVersion Int?
  /// 渠道交易号；页面搜索与对账用，唯一
  providerTradeNo       String?  @unique
  providerStatus        String?
  /// 'redirect' | 'qrcode' | 'sandbox'
  checkoutMode          String?
  /// 跳转地址或二维码载荷；只对当前进行中的意图有效
  checkoutValue         String?  @default("")
  checkoutExpiresAt     DateTime?
  lastQueriedAt         DateTime?
  /// 最近一次下单/查单失败原因（页面 create_failed 判定）
  lastError             String?
  closeStartedAt        DateTime?
  closedAt              DateTime?
  /// 渠道侧支付时间；paidAt 仍表示本地入账时间
  providerPaidAt        DateTime?
  /// 库存占用（inventory 商品）；支付/取消时释放
  stockReserved         Boolean  @default(false)

  @@index([channel, status, createdAt])
```

### 1.3 扩展 `Payment`

```prisma
  currency              String   @default("CNY")
  providerConfigId      String?
  providerConfigVersion Int?
  providerStatus        String?
  lastError             String?
  closedAt              DateTime?
```

`status` 继续用 `pending | succeeded | failed | closed`；补 `@@index([orderId, status])`。

### 1.4 新增 `PaymentNotification`

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

### 1.5 新增对账表

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

### 1.6 扩展 `Product`

```prisma
  /// 'CNY' | 'USD'
  currency            String   @default("CNY")
  /// 'credits'（本轮唯一启用）| 'storage'（Phase 5）
  kind                String   @default("credits")
  /// unlimited | periodic | inventory | timed
  saleStrategy        String   @default("unlimited")
  periodDays          Int      @default(0)
  periodPurchaseLimit Int      @default(0)
  stockTotal          Int      @default(0)
  stockReserved       Int      @default(0)
  stockSold           Int      @default(0)
  saleStartAt         DateTime?
  saleEndAt           DateTime?
```

说明：

- 保留现有 `type` 字段兼容旧数据；新逻辑以 `kind` 为准。
- 保留 `credits`（整数）与 `creditsValidDays`；不改成微积分。
- `status` 继续 `active | offline`；页面的「销售中/待发售/已结束/已售罄/已停用」由 `status + saleStrategy + 时间 + 库存` 派生。

### 1.7 站点设置

`backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` 增加：

- `payment.defaultCurrency`：默认 `CNY`，可选 `CNY / USD`，`group: 'payment'`，`public: true`（C 端充值面板也需要）。
- 同步 `SETTING_GROUP_LABELS` 增加 `payment: '支付'`。

---

## 2. 接口契约

统一响应信封与错误码沿用 `docs/api-contract.md`。

### 2.1 C 端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/payments/providers` | 可用渠道（`enabled && configured` 且支持订单币种），返回 `id / name / checkoutMode / icon` |
| POST | `/payments/:orderId/intent` | Body `{ providerId }`；下单并固定配置版本；返回 `mode / payUrl / codeUrl / expiresAt / sandbox` |
| GET | `/payments/:orderId/status` | 本地状态；`pending` 且 `lastQueriedAt` 超过 2s 时触发一次渠道查单 |
| POST | `/payments/:orderId/query` | 主动查单（前端「刷新支付状态」） |
| POST | `/orders/:orderId/cancel` | 未支付取消；已固定渠道时先查单再关单，渠道已支付则转已支付并返回 409 提示 |

`POST /orders` 不变（商品/会员、优惠、幂等键）。`intent` 的 `providerId` 在只有一个可用渠道时可省略，由服务端取唯一可用项；多个可用且未传 → `40001`。

### 2.2 后台 `/api/v1/admin/payments`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/providers` | `payment.read` | 渠道列表 + 当前配置版本 + 字段元数据 + `secretConfigured` |
| PUT | `/providers/:id/config` | `payment.write` | 保存新版本；高危操作 |
| GET | `/settings` | `payment.read` | 默认充值货币 |
| PUT | `/settings` | `payment.write` | 修改默认货币 |
| GET | `/products` | `product.read` | 充值商品列表（含上架状态计算） |
| POST | `/products` | `product.write` | 新建商品（内部走 `AdminCommerceService`） |
| PUT | `/products/:id` | `product.write` | 修改商品（内部走 `AdminCommerceService`） |
| GET | `/orders` | `payment.read` | 支付订单分页：`status / keyword / providerId / timeField / from / to / page / pageSize` |
| GET | `/orders/export.csv` | `payment.read + data.export` | 同筛选导出，上限 10000 |
| GET | `/orders/:id` | `payment.read` | 支付订单详情 |
| POST | `/orders/:id/query` | `payment.operate` | 空请求体；向渠道查单并应用结果 |
| POST | `/orders/:id/close` | `payment.operate` | 空请求体；先查单，已支付则入账；否则关单 |
| POST | `/reconciliations` | `finance.reconcile` | `{ providerId, billDate }`；唯一键冲突返回已有 run |
| GET | `/reconciliations` | `payment.read` | 运行列表：`providerId / status / from / to / page / pageSize` |
| GET | `/reconciliations/:id/items` | `payment.read` | 明细：`result / page / pageSize`；`result=abnormal` 表示所有非 matched/recovered |
| GET | `/reconciliations/export.csv` | `payment.read + data.export` | 汇总导出 |
| GET | `/reconciliations/:id/items/export.csv` | `payment.read + data.export` | 明细导出 |
| POST | `/reconciliations/import` | `finance.reconcile` | CSV 兜底导入（复用旧解析规则） |

新增权限点（`backend/src/admin/permissions.ts`）：

- `payment.write`：渠道配置写入；加入 `HIGH_RISK_PERMISSIONS`。
- `payment.operate`：查单/关单；授予 `admin / finance`。
- `payment.read` 继续用于所有读取。
- 商品复用现有 `product.read/write`，不新起一套商品权限。
- 对账沿用 `finance.reconcile`（导入、执行、补发）。

### 2.3 导出格式

沿用 `common/csv-response.ts` 的 BOM + `Content-Disposition`：

- 订单：订单号、用户、邮箱、商品、渠道、金额、币种、权益、状态、配置版本、渠道交易号、创建/支付/入账/关闭时间。
- 对账汇总：账单日期、渠道、状态、总笔数、一致、补发、异常、错误、完成时间。
- 对账明细：结果、商户订单号、渠道交易号、金额、币种、说明。

---


---

## 3. 细化说明：从方案到可开工工单

> 本节起为可执行细化稿，只补充实现细节与验收口径，不替换设计文档的业务目标。若与前文章节的字段名、接口形态或任务颗粒度冲突，**以本节为准**，并在 3.3 明列差异。

### 3.1 事实源与复刻边界

- 页面事实源：`open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`。参考站当前不可达，因此复刻依据是源码中的列、筛选、抽屉、空态、导出与按钮启用条件，不以截图猜测。
- 后端事实源：`open-ai-canvas/backend/internal/app/payment*.go` 与 `backend/payment-plugins/`；协议细节仍以支付宝/微信官方文档为准。
- 本仓库现状事实源：`backend/src/payments/*`、`backend/src/orders/order.service.ts`、`backend/prisma/schema.prisma`、`frontend/src/admin-ui/*`。
- “完整复刻”的范围是支付工作台三标签页（收款设置 / 交易核对 / 异常处理）的**信息架构与可操作项**：列、工具栏、筛选口径、分页、导出、详情 / 配置抽屉、五态与按钮禁用条件。视觉不照搬旧版 UI 库，改用本仓库 shadcn 原语；不新增旧版 UI 库引用。
- 本轮仍不实现存储扩容商品、聚合支付渠道、支付页内退款。

### 3.2 参考字段到本仓库字段的映射

| 参考实现 | 本仓库落地 | 说明 |
| --- | --- | --- |
| `merchantOrderNo` | `Order.orderNo` | 页面与 API 统一叫 `orderNo`；适配器内部才使用 `merchantOrderNo` 术语 |
| `providerId` | `Order.channel` | 不新增 `Order.providerId`；`channel` 就是适配器 id |
| `configId` | `PaymentProviderConfig.id` | 下单时固定；回调 URL 携带 |
| `amountFen` | `Order.paidCents` / `Product.priceCents` | 本仓库金额统一叫 `amountCents`，且是整数分 |
| `creditsMicrocredits` | `Product.credits` / `Order.grantedCredits` | 本仓库积分是整数，不做微积分换算 |
| `creditedAt` | `Order.paidAt` | `paidAt` 表示本地入账时间；渠道支付时间单独放 `providerPaidAt` |
| `enabled` | `Product.status === 'active'` | 商品上架/下架继续用现有 `status` |
| `saleStatus` | 派生值 | 由 `status + saleStrategy + 时间 + 库存` 计算，不落库 |
| `checkout.mode` | `Order.checkoutMode` | `redirect / qrcode / sandbox` |
| `checkout.value/url` | `Order.checkoutValue` | 跳转 URL 或二维码载荷 |
| `pluginEnabled` | 不引入 | 本仓库没有支付插件生命周期；用配置版本的 `enabled` 与适配器可用性替代 |

### 3.3 对 1 / 2 的细化修订

| # | 修订 | 原因 |
| --- | --- | --- |
| A1 | 后台支付控制器放在 `backend/src/admin/payments/`，注册在 `AdminModule`；支付域服务由 `PaymentsModule` 导出 | 权限、DTO 与其它后台控制器同层；支付域不反向依赖 admin 目录 |
| A2 | `POST /orders/:orderId/cancel` 的 URL 不变，但实现从 `OrdersController` 移到 `PaymentsModule` 的独立控制器 | 取消必须先查渠道；若让 `OrdersModule` 反向依赖 `PaymentsModule` 会形成循环依赖 |
| A3 | `PaymentReconciliationRun` 增加 `attempt Int @default(1)`，唯一键改为 `(providerId, billDate, attempt)` | 失败账单必须可重跑；只保留 `(providerId, billDate)` 会让一次网络失败永久锁死该日期 |
| A4 | 支付宝 ZIP 不引入 `fflate`；从现有 `backend/src/model/protocol/package.ts` 抽出通用只读 ZIP 解析器 | 已有 stored/deflate + 中央目录解析与测试；重复引依赖只会多一棵供应链 |
| A5 | 页面“入账时间”映射 `Order.paidAt`，不新增 `creditedAt` | 现有 `markPaid()` 已在同一事务里写 `paidAt`；新增字段会让两个时间源打架 |
| A6 | 后台列表响应统一为 `{ items, total, page, pageSize }`，不采用参考实现的 `{ orders }` / `{ runs }` | 与 `useAdminList()`、`AdminDataTable` 和本仓库其它后台列表一致 |
| A7 | 支付订单默认只查 `items.some({})` 的商品单；会员单留给 `/admin/orders` | 会员单的“商品/权益”口径不同，混排会让支付页的权益列失真 |
| A8 | `PaymentNotification.providerEventId` 缺失时使用 `sha256(providerId + ':' + rawBody)` 作为事件键 | 部分渠道不提供稳定事件 id；用原始报文摘要才能保证重复通知去重 |
| A9 | 旧 `/admin/payment-channels`、`/admin/reconciliation/batches*` 只保留一版兼容读；旧写入口返回 `41001` | 前端深链与值班脚本需要迁移窗口；继续写旧表会产生两套对账真相 |

---

## 4. 后端文件清单与职责

### 4.1 新增/调整的文件树

> **以下为拆分前（2026-11）的计划布局，后续服务已按职责拆分。当前实际布局以代码为准：**
> `backend/src/payments/` 下 `payment-{intent,close,lifecycle,query,settlement,attempt,routing,exception,config-admin}.service.ts` 等，
> 后台控制器合并为 `backend/src/admin/payments/payment-admin.controller.ts` + `payment-admin.service.ts`；不再有独立的 `payment-products.controller.ts`。

```text
backend/src/
├── common/
│   ├── security/
│   │   ├── secret-cipher.module.ts          # @Global：统一提供 SecretCipher
│   │   └── secret-cipher.ts                 # 从 model/infra 迁入，算法不变
│   ├── archive/
│   │   └── zip-reader.ts                    # 从 model/protocol/package.ts 抽出的只读 ZIP
│   └── setting-defs.ts                      # + payment.defaultCurrency
├── payments/
│   ├── adapters/
│   │   ├── payment-adapter.interface.ts     # 适配器/DTO/结果类型单一事实源
│   │   ├── payment-adapter.registry.ts      # 白名单、描述符、按 id 取适配器
│   │   ├── sandbox.adapter.ts
│   │   ├── alipay.adapter.ts
│   │   ├── wechat.adapter.ts
│   │   └── index.ts                         # PAYMENT_ADAPTERS
│   ├── bill/
│   │   ├── bill-http.ts                     # 下载超时/大小/域名白名单
│   │   ├── alipay-bill.parser.ts            # ZIP -> CSV -> BillRecord[]
│   │   └── wechat-bill.parser.ts            # CSV -> BillRecord[]
│   ├── payment-config.service.ts            # 版本、加密、字段元数据、引导 env
│   ├── payment-order.service.ts             # intent/query/close/applyResult
│   ├── payment-admin-order.service.ts       # 后台列表/详情/导出
│   ├── payment-notification.service.ts      # 收件箱写入、处理、重试
│   ├── payment-worker.service.ts            # 15s worker
│   ├── payment-reconciliation.service.ts    # 账单比对、二次查单、补发
│   ├── payments.service.ts                  # C 端门面（归属校验、0 元单）
│   ├── payments.controller.ts               # C 端 providers/intent/status/query/callback
│   ├── order-cancel.controller.ts           # 保持 /orders/:id/cancel URL
│   ├── payment-core.module.ts               # registry + config，无订单依赖
│   └── payments.module.ts                   # 编排 + worker + 对账
└── admin/
    └── payments/
        ├── payment-providers.controller.ts
        ├── payment-settings.controller.ts
        ├── payment-orders.controller.ts
        ├── payment-reconciliation.controller.ts
        └── dto/
            ├── payment-provider.dto.ts
            ├── payment-product.dto.ts
            ├── payment-order.dto.ts
            └── payment-reconciliation.dto.ts
```

### 4.2 支付域文件职责

| 文件 | 导出符号 | 职责 | 阶段 |
| --- | --- | --- | --- |
| `common/security/secret-cipher.module.ts` | `SecretCipherModule` | `@Global()` 提供/导出 `SecretCipher`；`AppModule` 导入一次；`ModelModule` 删除自己的 provider 声明 | 0 |
| `common/security/secret-cipher.ts` | `SecretCipher` | 只搬路径，不改 `enc:v1:` 格式；模型与支付共用 `MODEL_SECRET_KEY` | 0 |
| `common/archive/zip-reader.ts` | `listZipEntries()`、`readZipEntry()`、`ZipArchiveError` | 只读 ZIP：限制条目数、单条大小、总大小；拒绝路径穿越、符号链接、未知压缩方法 | 0 |
| `payments/adapters/payment-adapter.interface.ts` | 类型与 `PaymentAdapter` | 适配器契约；不出现 `process.env`、Prisma、订单状态 | 0 |
| `payments/adapters/payment-adapter.registry.ts` | `PaymentAdapterRegistry` | 维护 `PAYMENT_ADAPTERS`；提供 `descriptor(s)`、`get(id)`、`available(currency)`；生产过滤沙箱 | 0 |
| `payments/adapters/sandbox.adapter.ts` | `SandboxAdapter` | 站内模拟；生产永远不可用；回调可手工构造；`validateConfig` 无必填 | 0 |
| `payments/adapters/alipay.adapter.ts` | `AlipayAdapter` | RSA2 下单/查单/关单/验签/退款/账单；配置只从 `PaymentContext.values` 读 | 1/3 |
| `payments/adapters/wechat.adapter.ts` | `WechatAdapter` | v3 签名、查单/关单、AES-GCM 回调解密、退款、账单；配置只从 `values` 读 | 1/3 |
| `payments/bill/bill-http.ts` | `downloadBill()` | 仅允许官方域名；15s 超时；响应 ≤ 20MB；拒绝跳转到非白名单 host | 3 |
| `payments/bill/alipay-bill.parser.ts` | `parseAlipayBill()` | ZIP 内定位 CSV；GB18030/UTF-8 解码；忽略表头与空行；只保留成功交易 | 3 |
| `payments/bill/wechat-bill.parser.ts` | `parseWechatBillCsv()` | 解析 v3 账单 CSV；校验汇总行与明细行；只保留成功交易 | 3 |
| `payments/payment-config.service.ts` | `PaymentConfigService` | 版本化保存、加密、摘要、字段元数据、身份字段保护、env 首启引导、按订单解析配置 | 0/1 |
| `payments/payment-order.service.ts` | `PaymentOrderService` | 创建/复用支付尝试、固定配置版本、查单、关单、`applyPaymentResult()`、状态派生 | 2 |
| `payments/payment-admin-order.service.ts` | `PaymentAdminOrderService` | 后台分页/详情/CSV/查单/关单；把 `Order` 投影成支付页行 | 2 |
| `payments/payment-notification.service.ts` | `PaymentNotificationService` | 验签后落收件箱、唯一事件、同步处理一次、失败交给 worker | 2 |
| `payments/payment-worker.service.ts` | `PaymentWorkerService` | 15s 循环：收件箱、过期关单、pending 查单、每日对账 | 2/3 |
| `payments/payment-reconciliation.service.ts` | `PaymentReconciliationService` | 运行锁、账单导入、比对、二次查单、补发、重跑 | 3 |
| `payments/payments.service.ts` | `PaymentsService` | C 端门面：所有权校验、0 元单、按可用渠道选择、响应映射 | 2 |
| `payments/payments.controller.ts` | `PaymentsController` | `GET providers/settings`、`POST intent`、`GET status`、`POST query`、回调新旧两版 | 1/2 |
| `payments/order-cancel.controller.ts` | `OrderCancelController` | `@Controller('orders') @Post(':orderId/cancel')`；先查单再关单 | 2 |
| `payments/payment-core.module.ts` | `PaymentCoreModule` | `PrismaModule + ConfigModule + SecretCipherModule + registry + config`，不依赖 `OrdersModule` | 0 |
| `payments/payments.module.ts` | `PaymentsModule` | 编排服务、C 端控制器、worker；导入 `OrdersModule + PaymentCoreModule`；导出支付域服务 | 2 |

### 4.3 旧文件处置

| 现有文件 | 处置 |
| --- | --- |
| `payments/payment.factory.ts` | 删除；调用点改为 `PaymentAdapterRegistry` / `PaymentConfigService`。当前调用点只有 `payments.service.ts`、`admin/payment-channels.controller.ts`、`orders/order.service.ts` |
| `payments/alipay.provider.ts`、`wechat.provider.ts`、`sandbox.provider.ts` | 协议代码迁入对应 adapter；类名与构造参数改为显式接收 `PaymentContext`，不再在字段初始化时读 env |
| `payments/payment-provider.interface.ts` | 保留 `normalizePem()`、`centsToYuan()`、`yuanToCents()` 三个纯函数；旧的 env 型 `PaymentProvider` 契约删除 |
| `admin/payment-channels.controller.ts` | Phase 1 保留为兼容只读端点，内部改调 `PaymentConfigService`；Phase 4 删除 |
| `admin/reconciliation.controller.ts`、`reconciliation.service.ts` | Phase 3 起只读；旧导入/处置写入口返回 `41001`；Phase 4 删除旧页面后下线 |

### 4.4 后台文件职责

| 文件 | 路由 | 权限 | 职责 |
| --- | --- | --- | --- |
| `payment-providers.controller.ts` | `GET /admin/payments/providers`、`PUT /admin/payments/providers/:id/config` | `payment.read` / `payment.write` | 渠道列表、动态字段、保存新版本 |
| `payment-settings.controller.ts` | `GET/PUT /admin/payments/settings` | `payment.read` / `payment.write` | 默认充值币种，写入现有 settings 服务 |
| `admin/commerce.controller.ts` | `/admin/products*` | `product.read` / `product.write` | 充值商品已回到商品管理；支付域不再提供商品接口 |
| `payment-orders.controller.ts` | `GET /admin/payments/orders`、`GET /admin/payments/orders/export.csv`、`GET /admin/payments/orders/:id`、`POST .../:id/query`、`POST .../:id/close` | `payment.read` / `payment.read + data.export` / `payment.operate` | 列表、详情、导出、查单、关单 |
| `payment-reconciliation.controller.ts` | `POST/GET /admin/payments/reconciliations`、`GET .../:id/items`、两个 CSV、`POST .../import` | `finance.reconcile` / `payment.read` / `payment.read + data.export` | 执行、列表、明细、导出、CSV 兜底导入 |

### 4.5 模块接线

```ts
// common/security/secret-cipher.module.ts
@Global()
@Module({ providers: [SecretCipher], exports: [SecretCipher] })
export class SecretCipherModule {}

// app.module.ts：只导入一次
imports: [SecretCipherModule, /* ... */]

// model.module.ts：删除 providers/exports 里的 SecretCipher（全局模块已提供）

// payment-core.module.ts：没有 OrdersModule 依赖，是新的叶子
@Module({
  imports: [PrismaModule, ConfigModule, SecretCipherModule],
  providers: [...PAYMENT_ADAPTERS, PaymentAdapterRegistry, PaymentConfigService],
  exports: [PaymentAdapterRegistry, PaymentConfigService, ...PAYMENT_ADAPTERS],
})
export class PaymentCoreModule {}

// payments.module.ts
@Module({
  imports: [ConfigModule, PrismaModule, OrdersModule, PaymentCoreModule],
  controllers: [PaymentsController, OrderCancelController],
  providers: [
    PaymentOrderService,
    PaymentAdminOrderService,
    PaymentNotificationService,
    PaymentReconciliationService,
    PaymentWorkerService,
    PaymentsService,
  ],
  exports: [
    PaymentsService,
    PaymentOrderService,
    PaymentAdminOrderService,
    PaymentReconciliationService,
    PaymentCoreModule,
  ],
})
export class PaymentsModule {}

// admin.module.ts：新增五个支付后台控制器，providers 继续保留 AdminCommerceService
imports: [/* 现有 */ OrdersModule, PaymentsModule]
controllers: [/* 现有 */ ...PaymentProvidersController, PaymentSettingsController, PaymentProductsController, PaymentOrdersController, PaymentReconciliationController]
```

依赖方向必须保持无环：

```text
AdminModule ──→ PaymentsModule ──→ OrdersModule ──→ PaymentCoreModule
     │                │                                ↑
     └────────────────┴────────────────────────────────┘
```

- `PaymentCoreModule` 不导入 `OrdersModule`，因此 `OrdersModule` 可以在退款路径注入 `PaymentConfigService`。
- 取消订单的控制器虽然路由是 `/orders/:id/cancel`，但声明在 `PaymentsModule`，因此可以使用 `OrdersService` 与支付查单，而不产生反向模块依赖。
- 后台商品控制器注入 `AdminCommerceService`；支付模块不导入 `AdminModule`。

### 4.6 首次启动引导

`PaymentConfigService implements OnModuleInit`，只在**数据库没有任何 `PaymentProviderConfig`** 时执行一次：

1. 读取 `PAYMENT_PROVIDER`，非法值按 `sandbox` 处理并告警。
2. 按下表从现有 env 组装 v1 `values`；只创建该渠道，不为其它渠道造空配置。
3. `enabled = (providerId === PAYMENT_PROVIDER)`；真实渠道缺必填字段时仍创建版本但 `enabled=false`，启动日志 `error` 提示缺项，不自动降级沙箱。
4. `createdBy = 'bootstrap'`，`version=1`，`configDigest` 按完整配置计算。
5. 之后所有读写只看数据库；除 `PAYMENT_NOTIFY_BASE` 外不再从 env 读凭据。

| 适配器 | env → 配置字段 |
| --- | --- |
| `alipay` | `ALIPAY_APP_ID→appId`、`ALIPAY_PRIVATE_KEY→merchantPrivateKey`、`ALIPAY_PUBLIC_KEY→alipayPublicKey`、`ALIPAY_GATEWAY→gateway` |
| `wechat` | `WECHAT_APP_ID→appId`、`WECHAT_MCH_ID→mchId`、`WECHAT_SERIAL_NO→merchantSerialNo`、`WECHAT_PRIVATE_KEY→merchantPrivateKey`、`WECHAT_API_V3_KEY→apiV3Key`、`WECHAT_PLATFORM_PUBLIC_KEY→wechatPayPublicKey`、`WECHAT_PLATFORM_PUBLIC_KEY_ID→wechatPayPublicKeyId` |
| `sandbox` | 无 |

引导完成后再改 env 不生效；部署文档必须明确“改渠道请到后台保存新版本”。`PAYMENT_NOTIFY_BASE` 仍是部署配置，不进入后台可编辑字段，避免把回调地址改到不可达域名。

---

## 5. 后端类型、服务签名与 DTO

### 5.1 适配器契约

```ts
export type PaymentProviderId = 'sandbox' | 'alipay' | 'wechat';
export type PaymentCurrency = 'CNY' | 'USD';
export type CheckoutMode = 'redirect' | 'qrcode' | 'sandbox';

export interface PaymentConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'url' | 'select';
  required: boolean;
  secret?: boolean;
  default?: string;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  /** 已有订单后禁止变更（appId / mchId / sellerId 等） */
  identity?: boolean;
  maxLength?: number;
}

export interface PaymentAdapterDescriptor {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: CheckoutMode;
  configFields: PaymentConfigField[];
  supportedCurrencies: PaymentCurrency[];
  supportsReconciliation: boolean;
}

export interface PaymentContext {
  providerId: PaymentProviderId;
  configId: string;
  configVersion: number;
  /** 已解密的配置；适配器不得读取 env */
  values: Readonly<Record<string, string>>;
}

export interface CreateOrderInput {
  config: PaymentContext;
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: PaymentCurrency;
  subject: string;
  returnUrl: string;
  notifyUrl: string;
  expiresAt: Date;
}

export interface PaymentCheckout {
  mode: CheckoutMode;
  payUrl?: string;
  codeUrl?: string;
  providerRef?: string;
  expiresAt: Date;
  hint?: string;
}

export interface QueryOrderInput {
  config: PaymentContext;
  orderNo: string;
  providerTradeNo?: string;
}

export interface CloseOrderInput extends QueryOrderInput {}

export type ProviderPaymentState = 'paid' | 'pending' | 'closed' | 'not_found' | 'failed';

export interface ProviderPaymentResult {
  state: ProviderPaymentState;
  orderNo: string;
  tradeNo?: string;
  amountCents?: number;
  currency?: PaymentCurrency;
  paidAt?: Date;
  providerStatus?: string;
  error?: string;
  /** 渠道原始响应；只落库，不进接口响应 */
  rawPayload: string;
}

export interface NotificationInput {
  config: PaymentContext;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: Record<string, unknown>;
}

export type NotificationResult =
  | {
      ok: true;
      eventId: string;
      merchantOrderNo: string;
      providerTradeNo: string;
      amountCents: number;
      currency: PaymentCurrency;
      state: 'paid' | 'closed' | 'pending' | 'failed';
      paidAt?: Date;
      providerStatus: string;
      ackSuccess: boolean;
      reason?: string;
      rawPayload: string;
    }
  | {
      ok: false;
      ackSuccess: false;
      reason: string;
      rawPayload: string;
    };

export interface BillRecord {
  merchantOrderNo: string;
  providerTradeNo: string;
  amountCents: number;
  currency: PaymentCurrency;
  paidAt: Date;
  providerStatus: string;
}

export interface RefundInput {
  config: PaymentContext;
  orderNo: string;
  outRefundNo: string;
  amountCents: number;
  totalCents: number;
  reason?: string;
}

export interface RefundResult {
  state: 'succeeded' | 'processing' | 'failed';
  providerRefundId?: string;
  error?: string;
  raw?: string;
}

export interface PaymentAck {
  status: number;
  body: string;
  contentType: string;
}

export interface PaymentAdapter {
  readonly descriptor: PaymentAdapterDescriptor;
  validateConfig(values: Record<string, string>): string[];
  createOrder(input: CreateOrderInput): Promise<PaymentCheckout>;
  queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult>;
  closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult>;
  verifyNotification(input: NotificationInput): Promise<NotificationResult>;
  ack(result: NotificationResult): PaymentAck;
  refund(input: RefundInput): Promise<RefundResult>;
  downloadTradeBill?(config: PaymentContext, billDate: string): Promise<BillRecord[]>;
}
```

硬约束：

- `verifyNotification()` 验签失败返回 `ok:false`，不抛异常；网络/解密失败抛出时由收件箱服务转成渠道失败响应。
- `queryOrder()`、`closeOrder()` 的 `failed` 与 `not_found` 必须区分；前者不能本地关单，后者才可按规则本地关闭。
- 适配器只能通过 `PaymentContext.values` 取凭据；代码评审时 `rg "process\\.env" backend/src/payments/adapters` 必须为空。

### 5.2 首批配置字段

| 适配器 | 字段 |
| --- | --- |
| `sandbox` | 无必填 |
| `alipay` | `appId`（必填、identity）、`sellerId`（可选、identity）、`merchantPrivateKey`（secret、PEM）、`alipayPublicKey`（secret、PEM）、`gateway`（url，默认官方网关，白名单校验） |
| `wechat` | `appId`（必填、identity）、`mchId`（必填、identity）、`merchantSerialNo`（必填）、`merchantPrivateKey`（secret、PEM）、`apiV3Key`（secret、32 字节）、`wechatPayPublicKey`（secret、PEM）、`wechatPayPublicKeyId`（必填，必须与 `Wechatpay-Serial` 完全一致）、`apiBase`（url，默认 `https://api.mch.weixin.qq.com`，仅允许官方域名） |

`validateConfig()` 返回缺失/非法字段名，不返回值。保存时再校验：

- `closeAfterMinutes` 为 5–1440 的整数。
- 整个 `values` 序列化后 ≤ 32KB；单字段 ≤ 16KB。
- `apiV3Key` 解码后必须 32 字节；三份 PEM 必须能被 `createPrivateKey/createPublicKey` 解析。
- `gateway/apiBase` 只允许官方生产/沙箱域名；禁止 IP、localhost、非 HTTPS（测试环境显式放行 localhost 时需单独开关）。
- `enabled=true` 时必须 `validateConfig().length === 0`。

### 5.3 `PaymentConfigService` 签名

```ts
export interface ResolvedPaymentConfig {
  id: string;
  providerId: PaymentProviderId;
  version: number;
  enabled: boolean;
  closeAfterMinutes: number;
  values: Record<string, string>;
}

@Injectable()
export class PaymentConfigService implements OnModuleInit {
  onModuleInit(): Promise<void>;

  /** 后台列表：非密钥字段回显；密钥只回 secretConfigured */
  listAdmin(): Promise<AdminPaymentProviderView[]>;

  /** 保存新版本；空密钥沿用上一版；摘要相同返回当前版本且 unchanged=true */
  saveVersion(
    providerId: string,
    input: { enabled: boolean; closeAfterMinutes: number; values: Record<string, string> },
    actorId: string,
  ): Promise<{ provider: AdminPaymentProviderView; unchanged: boolean }>;

  /** 最新版本；未配置返回 null */
  latest(providerId: PaymentProviderId): Promise<ResolvedPaymentConfig | null>;

  /** 按回调 URL 的 configId 精确解析；不存在/渠道不匹配抛 4xx */
  byId(configId: string): Promise<ResolvedPaymentConfig>;

  /** 订单固定版本；历史单无 configId 时回落到同渠道最新版本 */
  resolveForOrder(order: {
    channel: string;
    providerConfigId: string | null;
    providerConfigVersion: number | null;
  }): Promise<ResolvedPaymentConfig>;

  /** C 端可选渠道：已启用、字段齐全、支持目标币种；生产过滤沙箱 */
  available(currency: PaymentCurrency): Promise<AvailableProviderView[]>;

  /** env → v1；只执行一次 */
  bootstrapFromEnv(): Promise<void>;
}
```

保存版本使用 Prisma 交互式事务：

1. 取当前最新版并解密。
2. 合并未提交的密钥字段。
3. `validateConfig` + 身份字段保护（已有订单且 identity 字段变化 → `40001`）。
4. 计算 `configDigest`；与当前相同直接返回当前版本。
5. `version = latest.version + 1`，`configCipher = cipher.encrypt(JSON.stringify(values))`。
6. create 新行；不更新旧行。

身份字段保护的范围只包括 `identity: true` 的字段；`gateway`、密钥轮换、关闭时长都可以产生新版本。已有订单的 `providerConfigId` 不变，因此旧订单回调仍用旧版本验签。

### 5.4 支付编排服务签名

```ts
@Injectable()
export class PaymentOrderService {
  /** 0 元单直接入账；否则选渠道、固定配置、写 pending Payment、返回 checkout */
  createIntent(input: {
    orderId: string;
    userId: string;
    providerId?: string;
  }): Promise<PaymentIntentView>;

  query(input: {
    orderId: string;
    actor: { kind: 'user'; userId: string } | { kind: 'admin'; adminId: string } | { kind: 'worker' };
  }): Promise<PaymentOrderView>;

  close(input: {
    orderId: string;
    actor: { kind: 'user'; userId: string } | { kind: 'admin'; adminId: string };
  }): Promise<PaymentOrderView>;

  /** 回调/查单/对账共用：金额、币种、交易号校验后走 markPaid */
  applyPaymentResult(input: {
    orderId: string;
    providerId: PaymentProviderId;
    configId: string;
    tradeNo: string;
    amountCents: number;
    currency: string;
    paidAt: Date;
    providerStatus?: string;
    rawPayload: string;
  }): Promise<{ applied: boolean; idempotentHit: boolean }>;
}
```

`createIntent()` 的落地顺序（顺序不可换）：

1. 校验订单归属、状态、过期时间、商品项；会员单允许支付，但不在支付页列表展示。
2. 0 元单：`markPaid({ payTransactionId: 'FREE-'+orderNo, channel: 'free' })`，返回 `mode=free`。
3. 用 `PaymentConfigService.available(currency)` 确定渠道；未传 `providerId` 且可用渠道不唯一 → `40001`。
4. 先关闭该订单其它 pending 尝试（`Payment.status='closed'`），再插入新的 `Payment(status='pending', payTransactionId=null)`。
5. 调 `adapter.createOrder()`；成功后写 `Order.providerConfigId/Version/channel/checkoutMode/checkoutValue/checkoutExpiresAt`，并更新 Payment 的配置版本。
6. 失败：Payment → `failed`，`Order.lastError` 截断 200 字，`checkoutValue=''`；返回原始业务错误（配置缺失仍是 503）。

`close()` 的顺序：抢占 `closeStartedAt` → 查单 → 已支付走 `applyPaymentResult` → 已关闭/不存在则本地关闭 → 未支付调渠道关单 → 关单后再查一次 → 仍失败保持 pending 并写 `lastError`。

### 5.5 后台 DTO 与校验

```ts
export class PaymentProviderConfigUpdateDto {
  @IsBoolean() enabled!: boolean;
  @Type(() => Number) @IsInt() @Min(5) @Max(1440) closeAfterMinutes!: number;
  @IsObject() values!: Record<string, string>;
}

export class PaymentSettingsUpdateDto {
  @IsIn(['CNY', 'USD']) defaultCurrency!: PaymentCurrency;
}

export class PaymentProductCreateDto {
  /** 省略时服务端生成 PAY-YYYYMMDD-XXXX；创建后不可改 */
  @IsOptional() @IsString() @MaxLength(40) sku?: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsIn(['credits']) kind!: 'credits';              // storage 返回 40001（D7）
  @IsIn(['CNY', 'USD']) currency!: PaymentCurrency;
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000) priceCents!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) credits!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) creditsValidDays?: number;
  @IsIn(['immediate', 'manual']) grantType!: 'immediate' | 'manual';
  @IsIn(['active', 'offline']) status!: 'active' | 'offline';
  @Type(() => Number) @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder!: number;
  @IsIn(['unlimited', 'periodic', 'inventory', 'timed']) saleStrategy!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) periodDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) periodPurchaseLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(9_000_000_000) stockTotal?: number;
  @IsOptional() @IsISO8601() saleStartAt?: string;
  @IsOptional() @IsISO8601() saleEndAt?: string;
}

export class PaymentProductUpdateDto extends PartialType(PaymentProductCreateDto) {
  /** 创建后禁止修改 sku/kind */
  @IsOptional() declare sku?: never;
  @IsOptional() declare kind?: 'credits';
}

export class PaymentOrderListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['created', 'pending', 'closing', 'create_failed', 'closed', 'credited', 'refunded']) status?: string;
  @IsOptional() @IsString() @MaxLength(120) keyword?: string;
  @IsOptional() @IsIn(['sandbox', 'alipay', 'wechat']) providerId?: string;
  @IsOptional() @IsIn(['created', 'paid', 'credited']) timeField?: 'created' | 'paid' | 'credited';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class PaymentReconciliationRunDto {
  @IsIn(['sandbox', 'alipay', 'wechat']) providerId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) billDate!: string;
  /** 失败重跑：attempt+1；已完成/执行中的同日运行不重跑 */
  @IsOptional() @IsBoolean() retryFailed?: boolean;
}

export class PaymentReconciliationListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['sandbox', 'alipay', 'wechat']) providerId?: string;
  @IsOptional() @IsIn(['running', 'completed', 'failed']) status?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
```

商品校验规则：

- `kind=storage` 返回 `40001`，文案「存储扩容商品将在配额子系统上线后开放」。
- `currency=USD` 且 `status=active` 时，必须存在支持 USD 的已启用渠道，否则 `40001`；保存为 `offline` 时只提示不阻断。
- `inventory`：`stockTotal >= stockSold + stockReserved`；更新库存低于占用时拒绝。
- `periodic`：`periodDays` 与 `periodPurchaseLimit` 必填且 > 0。
- `timed`：两者必填且 `saleStartAt < saleEndAt`；时区按 `Asia/Shanghai` 解释。
- 非对应策略的字段归零/null，避免切换策略后残留旧约束。
- `priceCents=0` 仅允许历史数据；支付页新建商品最低 1 分。免费领取继续走已有 `/admin/products` 入口。

### 5.6 响应形态

```ts
interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number }

interface AdminPaymentProviderView {
  id: PaymentProviderId;
  name: string;
  icon: string;
  checkoutMode: CheckoutMode;
  enabled: boolean;
  configured: boolean;
  closeAfterMinutes: number;
  version: number | null;
  configId: string | null;
  configEnabled: boolean;
  values: Record<string, string>;             // 仅非 secret 字段
  secretConfigured: Record<string, boolean>;
  configFields: PaymentConfigField[];
  missing: string[];
  updatedAt: string | null;
  warnings: Array<{ level: 'danger' | 'warn'; message: string }>;
}

interface AdminPaymentProductView {
  id: string;
  sku: string;
  name: string;
  description: string;
  kind: 'credits';
  currency: PaymentCurrency;
  priceCents: number;
  originalPriceCents: number | null;
  credits: number;
  creditsValidDays: number;
  grantType: 'immediate' | 'manual';
  status: 'active' | 'offline';
  enabled: boolean;
  sortOrder: number;
  saleStrategy: 'unlimited' | 'periodic' | 'inventory' | 'timed';
  periodDays: number;
  periodPurchaseLimit: number;
  stockTotal: number;
  stockReserved: number;
  stockSold: number;
  stockRemaining: number;
  saleStartAt: string | null;
  saleEndAt: string | null;
  saleStatus: 'disabled' | 'on_sale' | 'upcoming' | 'ended' | 'sold_out';
  canPurchase: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AdminPaymentOrderRow {
  id: string;
  orderNo: string;
  productName: string;
  productKind: 'credits';
  userId: string;
  user: { id: string; name: string; email: string } | null;
  providerId: string;
  providerConfigVersion: number | null;
  amountCents: number;
  currency: string;
  credits: number;
  status: PaymentOrderDisplayStatus;
  providerStatus: string | null;
  providerTradeNo: string | null;
  checkout: { mode: string; value: string | null; expiresAt: string | null };
  expiresAt: string;
  providerPaidAt: string | null;
  creditedAt: string | null;                    // 返回 Order.paidAt
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 5.7 错误码

| code | HTTP | 场景 |
| --- | --- | --- |
| `40001` | 400 | 参数/配置字段非法、币种无可用渠道、商品策略不合法 |
| `40301` | 403 | 非订单所有者、后台权限不足 |
| `40400` | 404 | 订单/渠道/配置/对账记录不存在 |
| `40901` | 409 | 订单状态不可支付/关闭/退款 |
| `40910` | 409 | 回调订单的配置版本与 URL 不一致 |
| `41001` | 410 | 已下线的旧对账写入口 |
| `50301` | 503 | 渠道未配置/凭据缺失/不可用（绝不降级沙箱） |
| `50302` | 503 | 配置解密失败、渠道协议失败、账单下载失败 |

错误文案禁止包含密钥、PEM、APIv3 Key、完整原始报文；原始报文只允许进 `Payment.rawPayload` / `PaymentNotification.payloadCipher`。

## 6. Prisma 最终模型、索引与升级

> 本节是**最终模型**。1 是初版草案；凡本节与 1 不一致处，以本节为准。差异集中在对账运行表的 `attempt`、通知收件箱的 `processing` 中间态，以及库存字段的语义。仍不引入 Prisma enum，所有状态继续用 `String` + service 白名单，原因见 1 开头。

### 6.1 `PaymentProviderConfig`（新增）

```prisma
/// 支付渠道配置。**追加写、不原地修改**。
/// 订单与 Payment 固定 providerConfigId/version，因此用历史订单回调验签时
/// 必须还能取到当时的密钥；覆盖旧行会让「已发出但未回调」的订单永久验签失败。
model PaymentProviderConfig {
  id                String   @id @default(cuid())
  /// 适配器 id：sandbox | alipay | wechat
  providerId        String
  /// 渠道内单调递增版本，从 1 开始
  version           Int
  enabled           Boolean  @default(false)
  closeAfterMinutes Int      @default(30)
  /// AES-256-GCM 密文；明文是 Record<string,string> 的 JSON，含密钥
  configCipher      String   @default("")
  /// 配置的规范化摘要（sha256），用于识别「无改动保存」
  configDigest      String   @default("")
  /// 管理员 id；首次 env 引导为 'bootstrap'
  createdBy         String?
  createdAt         DateTime @default(now())

  @@unique([providerId, version])
  @@index([providerId, createdAt])
}
```

约束：

- 只允许 `create`，不提供 `update`。轮换密钥、修改关闭时长、切换网关都产生新版本。
- `configCipher` 与 `configDigest` 不返回给后台；后台只回非 secret 字段与 `secretConfigured`。
- `enabled=true` 只是「允许新订单选择」；适配器仍要校验字段齐全与币种能力。

### 6.2 `Order` 扩展（最终字段）

现有字段（`orderNo / totalCents / discountCents / paidCents / refundedCents / grantedCredits / status / channel / paidAt / expiresAt`）保持不变。新增：

```prisma
  /// 订单币种；金额始终是最小单位（CNY 分 / USD 美分）
  currency              String   @default("CNY")

  /// 下单意图时固定的渠道配置。历史订单为空，回调按同渠道最新版兜底
  providerConfigId      String?
  providerConfigVersion Int?

  /// 渠道交易号。与 Payment.payTransactionId 对应；回调/查单/对账均可反查
  providerTradeNo       String?  @unique
  /// 渠道原始状态文本，仅展示与排障，不参与本地状态机
  providerStatus        String?

  /// redirect | qrcode | sandbox
  checkoutMode          String?
  /// 跳转 URL 或二维码载荷。终态必须清空，避免页面把过期链接当可用
  checkoutValue         String?  @default("")
  checkoutExpiresAt     DateTime?
  /// 最近一次向渠道查单的时间；用于 2 秒防抖与 worker 30 秒轮询
  lastQueriedAt         DateTime?

  /// 最近一次下单/查单/关单失败原因，截断 200 字；仅页面排障用
  lastError             String?
  /// 发起支付租约。覆盖“关闭旧尝试 → 渠道下单 → 写回 checkout”全过程；
  /// 与关单租约互斥，超时后才允许新请求接管。
  intentStartedAt       DateTime?
  /// 关单租约。条件更新抢占，防止用户手动关单与 worker 同时执行
  closeStartedAt        DateTime?
  closedAt              DateTime?

  /// 渠道侧支付时间；paidAt 仍是本地入账时间
  providerPaidAt        DateTime?

  /// 是否仍占用库存。库存性商品下单时 true，支付/取消时释放
  stockReserved         Boolean  @default(false)

  @@index([channel, status, createdAt])
  @@index([channel, providerPaidAt])
  @@index([channel, paidAt])
  @@index([status, paidAt])
  @@index([providerPaidAt])
  @@index([status, expiresAt])
  @@index([providerConfigId])
  @@index([paidAt])
  @@index([closedAt])
```

口径：

- `Order.status` 仍是 `pending | paid | cancelled | refunded | partial_refunded`。页面的 `created / closing / create_failed / credited` 是**派生展示状态**，不写库（见 [`payment-ui-design.md`](payment-ui-design.md) §3）。
- `providerTradeNo` 单独冗余在 Order 上，是为了支付页搜索和列表不必 join 最近一条 Payment；唯一约束也提供第二道重复交易号防线。
- 旧订单 `providerConfigId=null`：查单/回调使用同渠道**当前最新版**配置，并在第一次成功解析后回填 `providerConfigId/version`；不得为了回填而改变 `channel`。
- `checkoutValue` 在本地关闭、渠道关闭、支付成功、退款完成时置空；空串表示「没有可用支付动作」，`null` 只用于从未生成过 checkout 的历史数据。

### 6.3 `Payment` 扩展（最终字段）

```prisma
  currency              String   @default("CNY")
  providerConfigId      String?
  providerConfigVersion Int?
  providerStatus        String?
  /// 单次支付尝试的失败原因；不影响 Order.lastError 的展示优先级
  lastError             String?
  closedAt              DateTime?

  @@index([orderId, status])
```

`status` 仍为 `pending | succeeded | failed | closed`。一次 intent 对应一行 Payment：

1. 创建 intent 时先 `status='pending'`，`payTransactionId=null`；
2. 支付成功时把该行更新为 `succeeded`，写入 `payTransactionId / paidAt / rawPayload`；
3. 下单失败更新为 `failed`；取消/关单更新为 `closed`；
4. 手工核销、0 元单、历史兼容等没有待定行的场景，允许 `markPaid()` 新建一行。

`payTransactionId` 继续保持 `@unique`。SQLite 的唯一索引允许多个 `NULL`，因此多笔 pending 不冲突。

### 6.4 `PaymentNotification`（新增，最终字段）

```prisma
/// 渠道异步通知收件箱。验签通过后、入账前落库，保证进程重启不丢通知。
model PaymentNotification {
  id               String   @id @default(cuid())
  providerId       String
  /// 渠道事件 id；渠道不提供时用 sha256(providerId + ':' + rawBody)
  providerEventId  String
  /// 回调 URL 固定下来的配置版本；旧回调可为空并按最新版解析
  providerConfigId String
  merchantOrderNo  String
  orderId          String?
  /// sha256(rawBody)，用于排障与日志关联，不落明文
  payloadDigest    String
  /// 验签通过的原始报文 AES-256-GCM 密文
  payloadCipher    String   @default("")
  /// 适配器归一化后的业务字段 JSON；不得含密钥，可含渠道交易字段
  normalizedJson   String   @default("{}")
  /// pending | processing | processed | failed
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
  @@index([orderId])
}
```

`processing` 是 worker 的租约状态：`updateMany({ where: { id, status: { in: ['pending','failed'] }, nextAttemptAt: { lte: now } }, data: { status: 'processing', attempts: { increment: 1 } } })` 只有一条能抢到。进程崩溃留下的 `processing` 在 `updatedAt < now - 5min` 时由 worker 重置为 `failed`，不会永久卡住。

### 6.5 对账表（新增，修订 1.5）

```prisma
/// 单次对账运行。失败可在同一账单日重跑，attempt 递增，历史运行不覆盖。
model PaymentReconciliationRun {
  id             String   @id @default(cuid())
  providerId     String
  /// 运行时使用的配置版本；证据链不依赖「当前最新版」
  configId       String?
  billDate       String
  /// 同一渠道同一账单日的第几次运行，从 1 开始
  attempt        Int      @default(1)
  /// provider（渠道自动下载）| csv（人工上传兜底）
  source         String   @default("provider")
  fileName       String?
  /// running | completed | failed
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

  @@unique([providerId, billDate, attempt])
  @@index([providerId, billDate, status])
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
  /// 该差异是否已由本次运行自动处理；不表示人工结案
  resolved        Boolean  @default(false)
  detail          String?
  createdAt       DateTime @default(now())

  run PaymentReconciliationRun @relation(fields: [runId], references: [id])

  @@unique([runId, merchantOrderNo])
  @@index([result])
  @@index([providerId, merchantOrderNo])
}
```

重跑规则：

- `attempt` 只由服务端计算：`max(attempt)+1`，客户端不得传。
- 同日已有 `running` → `40901`；最新一次 `completed` 且 `retryFailed=false` → 返回该 run，`reused=true`；最新一次 `failed` 且 `retryFailed=true` → 新建 `attempt+1`。
- 旧 `ReconciliationBatch/Item` 不再写；保留只读一版用于历史查看，旧写接口返回 `41001`（7.7）。

### 6.6 `Product` 扩展（最终字段）

```prisma
  /// CNY | USD
  currency            String   @default("CNY")
  /// credits（本轮唯一启用）| storage（Phase 5）
  kind                String   @default("credits")
  /// unlimited | periodic | inventory | timed
  saleStrategy        String   @default("unlimited")
  periodDays          Int      @default(0)
  periodPurchaseLimit Int      @default(0)
  stockTotal          Int      @default(0)
  stockReserved       Int      @default(0)
  stockSold           Int      @default(0)
  saleStartAt         DateTime?
  saleEndAt           DateTime?

  @@index([status, kind, sortOrder])
```

说明：

- 保留现有 `type` 字段兼容旧数据；新逻辑只读 `kind`。`type` 不再由新接口写入。
- `stockRemaining = stockTotal - stockSold - stockReserved` 是计算值，不落库，避免三个数字互相漂移。
- 库存占用发生在**下单**而非发起支付：否则多个用户可先建单、再慢慢付款，把库存卖穿。释放发生在订单取消/超时；支付成功时 `stockReserved--`、`stockSold++`。
- 周期购买次数按「该用户在该商品上，最近 `periodDays` 天内、状态非 cancelled 的订单数」计算；退款不恢复次数。
- 限时窗口按 `Asia/Shanghai` 解释后台输入的时间；数据库存 UTC。
- 会员套餐本轮不进入支付商品表，会员订单仍由 `/admin/orders` 管理。

### 6.7 站点设置新增键

`backend/src/common/setting-defs.ts`：

```ts
{ key: 'payment.defaultCurrency', group: 'payment', type: 'select', options: ['CNY','USD'], default: 'CNY', public: true }
```

同时在 `SETTING_GROUP_LABELS` 增加 `payment: '支付'`。该键只决定**新建商品默认币种**与 C 端充值面板默认 tab，不改写历史商品价格。

### 6.8 升级顺序与旧数据兼容

本仓库以 Prisma Migrate 管理 SQLite（2026-11-24 起；此前为 `db push`）。上线按以下顺序，任一步失败都停在原地，不继续：

```bash
# 1. 备份（生产必须先做；开发库也建议）
cp backend/dev.db "backend/backups/dev-$(date +%Y%m%d-%H%M%S).db"

# 2. 停后端，避免旧进程继续写旧字段
# 3. 校验 schema 可解析并生成 client
cd backend && npx prisma validate && npm run prisma:generate

# 4. 应用迁移（只新增表/可空列/带默认值列；已应用的迁移不会重跑）
npm run db:migrate:dev        # 开发库：生成并应用新迁移
npm run db:migrate:deploy     # 测试 / 生产：只应用已有迁移

# 5. 核对新增表与关键索引
sqlite3 dev.db ".schema PaymentProviderConfig"
sqlite3 dev.db "PRAGMA index_list('PaymentReconciliationRun');"

# 6. 回填历史支付单（一次性脚本，幂等）
npm run backfill:payment-orders

# 7. 同步角色权限
npm run seed:roles
```

`backfill:payment-orders` 新增在 `backend/scripts/backfill-payment-orders.ts`，只做六件事，可重复执行：

1. `Order.currency` 为空/空串 → `CNY`（schema 默认值通常已填）。
2. 已支付且 `providerTradeNo=null` 的订单，取最近一条 `Payment.status='succeeded'` 的 `payTransactionId` 回填；`FREE- / MANUAL- / SANDBOX-` 前缀同样保留，便于区分非渠道入账。
3. 已支付且 `providerPaidAt=null` 的订单，用 `Payment.paidAt` 回填；没有 Payment 的保持 null。
4. 已取消且 `closedAt=null` 的订单，用 `updatedAt` 回填（只作展示，不参与资金计算）。
5. 已支付/已退款且 `totalCents>0`、`paidCents=0` 的历史单，回填 `paidCents=totalCents-discountCents`。这条是支付页按 `paidCents` 排序与展示金额的前提；0 元免费单保持 0。回填前先 `SELECT count(*)` 核对影响面，脚本按 id 分批、可重复执行。
6. 空串归一化：`Order.lastError='' → null`、`Order.providerTradeNo='' → null`、`Payment.payTransactionId='' → null`、`PaymentNotification.lastError='' → null`、`PaymentReconciliationRun.error='' → null`。`Order.checkoutValue` 的空串有「支付动作已失效」语义，必须保留，不能一起清成 null。

不做的回填：`providerConfigId/Version`、`Payment.currency` 的历史推断、`Product.stock*`。这些字段的默认值已经能保证旧数据可读；强行猜测配置版本反而会让旧回调验签选错密钥。

### 6.9 种子与权限矩阵

`backend/src/admin/permissions.ts` 最终增加：

```ts
paymentRead: 'payment.read',          // 已存在
paymentWrite: 'payment.write',        // 新增：渠道配置写入
paymentOperate: 'payment.operate',    // 新增：查单/关单
financeReconcile: 'finance.reconcile' // 已存在：执行对账/兜底导入
```

授权口径：

| 角色 | 读取 | 保存渠道配置 | 查单/关单 | 执行对账/导入 |
| --- | --- | --- | --- | --- |
| 管理员 | ✅ | ✅ | ✅ | ✅ |
| 财务 | ✅ | ❌（避免财务同时改收款通道与做账） | ✅ | ✅ |
| 运营 | 默认 ❌（如业务确需排障，单独在角色页授予 `payment.read`） | ❌ | ❌ | ❌ |

`payment.write` 加入 `HIGH_RISK_PERMISSIONS`，保存渠道配置不要求填写 `reason`。`payment.operate` 不是高危：它只推进渠道已经发生的事实，不能凭空造钱。

`seed:roles` 会用代码中的 `ROLE_PERMISSIONS` 覆盖内置角色权限（见 `backend/scripts/seed-roles.ts`）。生产若已在角色页手工调过权限，先导出/核对再执行，避免覆盖自定义授权。

## 7. 后端接口最终契约与实现顺序

### 7.1 通用约定

- 前缀：全局 `app.prefix = api/v1`，下文省略 `/api/v1`。
- 成功响应沿用 `ResponseInterceptor` 信封：`{ code: 0, data, message }`。本文只写 `data`。
- 错误沿用 `AppError(code, message, status)`；`code` 见 5.7。
- 所有后台接口必须 `@UseGuards(JwtAuthGuard, AdminGuard)` 并显式 `@RequirePermission(...)`；不能只靠导航隐藏。
- 所有分页列表返回 `{ items, total, page, pageSize }`。固定规模列表（渠道）也返回该结构，`page=1`、`pageSize=items.length`，保证前端 `useAdminList` 可复用。
- 日期筛选参数一律 `YYYY-MM-DD`，按 `Asia/Shanghai` 取自然日并转成 UTC 边界：`from=2026-10-01` → `2026-09-30T16:00:00.000Z`，`to=2026-10-01` → `2026-10-02T15:59:59.999Z`。
- 金额字段一律整数最小单位；接口字段名统一 `amountCents / priceCents / originalPriceCents`，不出现 `amountFen`。
- 敏感值只进密文列；任何响应都不能包含 `configCipher / payloadCipher / rawPayload`。

### 7.2 C 端支付

#### `GET /payments/providers`

查询参数（均可选）：

- `orderId`：已存在订单时按其币种过滤；服务端校验归属。
- `currency`：无订单时指定 `CNY / USD`；缺省取 `payment.defaultCurrency`。

响应：

```json
{
  "items": [
    {
      "id": "alipay",
      "name": "支付宝",
      "icon": "alipay",
      "checkoutMode": "redirect",
      "supportedCurrencies": ["CNY"],
      "sandbox": false
    },
    {
      "id": "wechat",
      "name": "微信支付",
      "icon": "wechat",
      "checkoutMode": "qrcode",
      "supportedCurrencies": ["CNY"],
      "sandbox": false
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 2
}
```

规则：

- 只返回 `enabled=true`、`validateConfig()` 为空、支持目标币种的渠道。
- `NODE_ENV=production` 永远过滤 `sandbox`；开发/测试保留并在响应里显式 `sandbox=true`。
- 无可用渠道返回空列表，不返回 503；真正发起支付时才返回 `50301`，C 端据此显示「支付暂不可用」。

#### `POST /payments/:orderId/intent`

请求：

```json
{ "providerId": "alipay" }
```

`providerId` 可省略，仅在恰好一个可用渠道时自动选择；多个可用且未传返回 `40001`。`sandbox` 只能在非生产环境选择。

响应：

```json
{
  "orderId": "ord_x",
  "orderNo": "PAY202611010001",
  "amountCents": 9900,
  "currency": "CNY",
  "providerId": "alipay",
  "configId": "ppc_x",
  "configVersion": 3,
  "mode": "redirect",
  "payUrl": "https://openapi.alipay.com/gateway.do?...",
  "codeUrl": null,
  "checkoutValue": "https://openapi.alipay.com/gateway.do?...",
  "expiresAt": "2026-11-01T12:30:00.000Z",
  "sandbox": false,
  "hint": null
}
```

规则：

- 0 元单不选渠道，返回 `mode='free'`、`providerId='free'`、`sandbox=false`，并已完成入账。
- 成功发起后，`Order.expiresAt` 取 `min(原 expiresAt, now + config.closeAfterMinutes)`；`checkoutExpiresAt` 取渠道返回的实际过期时间（无则同上）。
- 调用渠道超时/网络失败：Payment 置 `failed`，`Order.lastError` 截断 200 字，`checkoutValue=''`，返回 `50302`；不自动改回沙箱。
- 同一订单重复发起：先把旧 pending Payment 置 `closed`，再创建新 Payment；旧二维码/跳转链接由渠道过期，不依赖本地删除。
- 响应不返回 `rawPayload`，也不返回任何凭据字段。

#### `GET /payments/:orderId/status`

响应：

```json
{
  "orderId": "ord_x",
  "orderNo": "PAY202611010001",
  "status": "pending",
  "displayStatus": "pending",
  "amountCents": 9900,
  "currency": "CNY",
  "providerId": "alipay",
  "checkoutMode": "redirect",
  "checkoutValue": "https://openapi.alipay.com/gateway.do?...",
  "expiresAt": "2026-11-01T12:30:00.000Z",
  "providerPaidAt": null,
  "creditedAt": null,
  "closedAt": null,
  "lastError": null,
  "payments": [
    {
      "id": "pay_x",
      "status": "pending",
      "providerId": "alipay",
      "providerTradeNo": null,
      "amountCents": 9900,
      "createdAt": "2026-11-01T12:00:00.000Z"
    }
  ]
}
```

本地 `pending` 且 `lastQueriedAt < now-2s` 时触发一次渠道查单；查询失败不改变本地状态，只写 `lastError`。已到账/已关闭时 `checkoutValue` 必为空串。

#### `POST /payments/:orderId/query`

主动查单，节流 2 秒。返回同 `status`。未固定渠道、渠道已关闭、订单已终态时返回当前本地视图，不报 409（这是刷新动作，不是状态变更）。

#### `POST /orders/:orderId/cancel`

URL 与请求体不变，实现迁到 `OrderCancelController`。返回 C 端订单视图；已取消重复调用返回 200 幂等结果。

顺序固定：

1. 校验归属与 `pending`。
2. 有 `providerConfigId` 或 `channel` 非 sandbox/free 时先查单。
3. 渠道已支付 → `applyPaymentResult()` 入账，然后返回 `40901`（message「渠道已支付，订单已入账，请刷新」）。
4. 渠道未支付/不存在 → 调渠道关单，再查一次。
5. 仍无法确认 → 保持 pending，写 `lastError`；返回 `50302`，不把订单伪装成已取消。
6. 确认未支付或渠道关单成功 → 本地 `cancelled`、`closedAt=now`、关闭 pending Payment、清空 checkout、释放库存。

#### 回调路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/api/v1/payment/webhook/easypay` | 易支付固定入口；按订单历史 Payment 反查配置版本 |
| POST | `/api/v1/payment/webhook/alipay` | 支付宝官方固定入口；按商户订单号反查历史配置 |
| POST | `/api/v1/payment/webhook/wxpay` | 微信支付固定入口；先解密，再按历史配置验签 |
| POST | `/api/v1/payment/webhook/stripe` | Stripe 固定入口；以 PaymentIntent id 为主精确匹配历史 Payment，历史 Checkout Session 仅兼容旧单 |

EasyPay / 支付宝 / 微信 / Stripe 的通知 URL 由 `createOrder()` 传入固定地址，不随配置版本轮换。PayPal / ZPay / 沙箱没有规范入口，`notifyUrl()` 抛出 `50301`，不会生成没有接收方的地址。

`PaymentNotificationService.ingestCanonical()` 的响应必须由适配器的 `ack()` 生成：支付宝纯文本 `success/fail`，微信 JSON `{code,message}`，不能套统一信封。

### 7.3 后台渠道与设置

#### `GET /admin/payments/providers`

权限 `payment.read`。响应 `PageResult<AdminPaymentProviderView>`。在 5.6 基础上补两个字段：

```ts
interface AdminPaymentProviderView {
  // ...5.6 已有字段
  /** 已有订单绑定过该渠道的 identity 字段时，后台不允许修改 */
  identityLockedFields: string[];
  /** 当前是否有未完成订单引用旧版本，用于文案提示 */
  hasOpenOrders: boolean;
}
```

`values` 只含非 secret 字段；secret 字段只返回 `secretConfigured[name]=true`。`missing` 是当前版本缺失的必填项；`warnings` 用于「渠道已启用但缺密钥」「网关非官方域名」「生产仍启用沙箱」。

#### `PUT /admin/payments/providers/:providerId/instances/:instanceId/config`

权限 `payment.write`，高危操作，但不要求填写原因。请求体见 5.5。响应：

```json
{ "provider": { "id": "alipay", "version": 4, "configured": true }, "unchanged": false }
```

空字符串的 secret 字段表示「沿用上一版」；要清空 secret 不允许，必须禁用渠道并保存新版本。身份字段（`identity=true`）一旦有历史订单绑定，修改返回 `40001`。

#### `GET/PUT /admin/payments/settings`

权限分别 `payment.read / payment.write`。GET 返回 `{ "defaultCurrency": "CNY" }`；PUT 请求 `{ defaultCurrency }`，写现有 settings 服务。

#### 商品接口（已迁回 `/admin/products`）

> 拆分前契约中的 `GET/POST /admin/payments/products` 已删除，商品统一由 `admin/commerce.controller.ts` 的 `/admin/products*` 提供；以下仅保留字段语义供对照。

权限 `product.read`。响应 `PageResult<AdminPaymentProductView>`。默认按 `sortOrder asc, createdAt desc`，一次最多返回 500 条；页面不显示分页（与参考页一致），超过 500 条说明商品配置方式需要治理。

#### `POST /admin/products`、`PUT /admin/products/:id`

权限 `product.write`。请求体见 5.5。响应 `{ product }`。服务端通过 `AdminCommerceService.savePaymentProduct()` 写 `Product`，不能另建一套商品表。

保存时校验：

- SKU：新建省略时生成 `PAY-YYYYMMDD-XXXX`；编辑不可改。
- `kind=storage` 永远 `40001`（D7）。
- `currency=USD` 且 `status=active`：必须至少有一个启用且支持 USD 的渠道，否则 `40001`。
- 库存：`stockTotal >= stockSold + stockReserved`；下架不清空库存。
- 周期：两个字段都 > 0；切换策略时把不相关字段归零。
- 限时：`saleStartAt < saleEndAt`，按上海时区解释；允许开始时间已过，但结束时间必须晚于当前。
- `priceCents` 最低 1；`credits` 最低 1；`creditsValidDays=0` 表示永久。

### 7.4 后台支付订单

#### `GET /admin/payments/orders`

权限 `payment.read`。查询参数：

| 参数 | 类型 | 口径 |
| --- | --- | --- |
| `status` | string | 页面派生状态：`created/pending/closing/create_failed/closed/credited/refunded/partial_refunded` |
| `keyword` | string | 去首尾空格；匹配订单号、商品快照名、用户姓名/邮箱/完整 id、渠道交易号 |
| `providerId` | string | 映射 `Order.channel`；只接受 `sandbox/alipay/wechat` |
| `timeField` | `created/paid/credited` | `created→createdAt`、`paid→providerPaidAt`、`credited→paidAt` |
| `from/to` | date | 按 `timeField` 过滤，包含首尾两天 |
| `page/pageSize` | number | 默认 1/30；`pageSize` 上限 100。页面显式传 30，API 默认值也按参考页对齐 |
| `sort` | string | 白名单 `createdAt/providerPaidAt/paidAt/amountCents`，格式 `field:asc` 或 `field:desc` |

固定条件：`items: { some: {} }`，即只展示商品订单；会员订单仍在 `/admin/orders`。默认排序 `createdAt:desc`。

响应：

```json
{
  "items": [
    {
      "id": "ord_x",
      "orderNo": "PAY202611010001",
      "productName": "1000 积分",
      "productKind": "credits",
      "userId": "u_x",
      "user": { "id": "u_x", "name": "张三", "email": "z@example.com" },
      "providerId": "alipay",
      "providerConfigVersion": 3,
      "amountCents": 9900,
      "currency": "CNY",
      "credits": 1000,
      "status": "pending",
      "providerStatus": "WAIT_BUYER_PAY",
      "providerTradeNo": null,
      "checkout": { "mode": "redirect", "value": "https://...", "expiresAt": "2026-11-01T12:30:00.000Z" },
      "expiresAt": "2026-11-01T12:30:00.000Z",
      "providerPaidAt": null,
      "creditedAt": null,
      "closedAt": null,
      "createdAt": "2026-11-01T12:00:00.000Z",
      "updatedAt": "2026-11-01T12:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 30
}
```

`status` 由 `paymentStatusMeta.ts` 与后端共用的派生规则生成；后端只返回派生值，不返原始 Order.status 让前端二次推断。原始状态可放 `rawOrderStatus` 仅供排障，不展示为主状态。

#### `GET /admin/payments/orders/:id`

权限 `payment.read`。返回 `{ order: AdminPaymentOrderRow & { items, payments, actions } }`：

```ts
interface PaymentOrderDetail extends AdminPaymentOrderRow {
  rawOrderStatus: string;
  items: Array<{ id: string; name: string; quantity: number; credits: number; validDays: number }>;
  payments: Array<{ id: string; status: string; payTransactionId: string | null; amountCents: number; createdAt: string; paidAt: string | null }>;
  actions: { canQuery: boolean; canClose: boolean };
}
```

详情不返回 `rawPayload`、不返回配置值。`actions` 由后端按状态与渠道给出，前端仍按 `payment.operate` 权限二次隐藏。

#### `POST /admin/payments/orders/:id/query`

权限 `payment.operate`。空请求体；调用 `PaymentOrderService.query({ actor: { kind:'admin', adminId } })`。返回：

```json
{ "order": { "id": "ord_x", "status": "credited" }, "view": { "orderId": "ord_x", "displayStatus": "credited" } }
```

渠道失败返回 `50302`，不返回 200 + 旧状态伪装成功。

#### `POST /admin/payments/orders/:id/close`

权限 `payment.operate`。空请求体。顺序与 C 端取消一致；已支付时先入账再返回 `40901`，由前端刷新列表。已关闭返回幂等 200。

#### `GET /admin/payments/orders/export.csv`

权限 `payment.read + data.export`。筛选参数与列表完全一致，忽略 `page/pageSize`，上限 10000 行。`Content-Disposition` 文件名：`支付订单-YYYYMMDD-HHmmss.csv`。导出参数里不得含密钥。

### 7.5 后台对账

#### `POST /admin/payments/reconciliations`

权限 `finance.reconcile`。请求：

```json
{ "providerId": "alipay", "billDate": "2026-10-31", "retryFailed": false }
```

响应 200（复用）或 201（新建）：`{ run, reused }`。执行流程：

1. 校验账单日期不晚于昨天、不早于 90 天前。
2. 读最新 run：`running` → 409；`completed` 且非强制重跑 → 返回该 run；`failed` 且 `retryFailed=true` → 新 attempt。
3. 创建 run（`status='running'`，`source='provider'`），先落库再下载账单；下载失败更新 `failed` 并保留 error。
4. 调适配器 `downloadTradeBill(config, billDate)`；账单解析只保留成功交易。
5. 比对与补发见 §20.8.3；全部完成后写计数与 `completedAt`。

#### `GET /admin/payments/reconciliations`

权限 `payment.read`。参数 `providerId/status/from/to/page/pageSize`，默认 1/30，按 `billDate desc, attempt desc, id asc`。返回 `PageResult<PaymentReconciliationRun>`。

#### `GET /admin/payments/reconciliations/:id/items`

权限 `payment.read`。参数 `result`、`page/pageSize`，默认 1/50。`result=abnormal` 等价于 `result NOT IN ('matched','recovered')`；未知 result 返回 `40001`。返回：

```json
{ "run": { "id": "run_x", "status": "completed" }, "items": [], "total": 0, "page": 1, "pageSize": 50 }
```

#### `POST /admin/payments/reconciliations/import`

权限 `finance.reconcile`。`multipart/form-data`：`file + providerId + billDate`。只接受 `.csv` 或支付宝 `.zip`；≤ 20MB。解析出的记录走同一套比对逻辑，run.source 记为 `csv`。CSV 表头必须能被现有 `reconciliation.service.ts` 的解析器识别；支付宝 ZIP 复用 4.1 的 `zip-reader.ts`。

#### 对账导出

| 路径 | 权限 | 内容 |
| --- | --- | --- |
| `GET /reconciliations/export.csv` | `payment.read + data.export` | 运行汇总，筛选项同列表 |
| `GET /reconciliations/:id/items/export.csv` | `payment.read + data.export` | 单次运行明细，`result` 可选 |

明细导出只允许 `status='completed'` 的 run；执行中返回 `40901`。

### 7.6 CSV 列（最终）

订单：

```text
订单号,用户ID,用户名,用户邮箱,商品,渠道,金额(分),币种,权益(积分),状态,配置版本,渠道交易号,创建时间,支付时间,入账时间,关闭时间
```

对账汇总：

```text
账单日期,渠道,执行次数,状态,总笔数,一致,自动补发,异常,错误,开始时间,完成时间
```

对账明细：

```text
结果,商户订单号,渠道交易号,金额(分),币种,说明
```

时间用 `YYYY-MM-DD HH:mm:ss`（Asia/Shanghai），CSV 仍由 `sendCsv()` 加 UTF-8 BOM。

### 7.7 旧入口兼容与下线

| 旧入口 | Phase 1–3 | Phase 4 |
| --- | --- | --- |
| `GET /admin/payments`、`/admin/payments/export`（支付流水） | 保留只读，前端改名为 `adminPaymentLedgerApi` | 保留；它是既有流水查询，不与新订单列表混用 |
| `GET /admin/payment-channels` | 只读兼容，内部转 `PaymentConfigService.listAdmin()` | 删除；页面路由已重定向 |
| `GET /admin/reconciliation/batches*` | 只读兼容，读旧表 | 删除；历史数据仍留库 |
| `POST /admin/reconciliation/import` | 迁移窗口可继续写旧表，响应头 `Deprecation: true` | `41001` |
| `POST /admin/reconciliation/items/:id/resolve` | 迁移窗口可继续写旧表 | `41001` |

`41001` 响应体沿用统一错误信封，message 固定「旧对账写入口已下线，请使用 /admin/payments/reconciliations」，并带 `data: { replacement: '/admin/payments?tab=reconciliation' }`。前端旧页面在 Phase 4 删除。

### 7.8 服务签名、事务边界与状态落库

#### 20.8.1 `markPaid()` 扩展

`OrderService.markPaid()` 是唯一入账入口，签名扩展为：

```ts
export interface MarkPaidInput {
  orderId: string;
  userId: string;
  payTransactionId: string;
  channel: string;
  currency?: string;
  providerConfigId?: string;
  providerConfigVersion?: number;
  providerStatus?: string;
  providerPaidAt?: Date;
  /** intent 阶段已创建的 pending Payment；有则原地更新，不再新建 */
  paymentId?: string;
  sandboxScenario?: string;
  rawPayload?: string;
}

async markPaid(params: MarkPaidInput): Promise<{
  order: OrderView;
  idempotentHit: boolean;
  message?: string;
}>;
```

事务内顺序（不可调换）：

1. 按 `payTransactionId` 查重；已存在 → 查订单并返回 `idempotentHit=true`。
2. 读取订单、items、membershipPlan；非 pending → 409；已 paid → 幂等返回。
3. 校验 `currency`（缺省 CNY）与订单币种一致；金额以 Payment 行为准，不在此处重算订单价。
4. 有 `paymentId` 时 `updateMany({ where: { id, orderId, status:'pending' }, data: succeededFields })`；更新 0 行则回退为 create（防止旧 pending 已被关单）。
5. 无 `paymentId` 时 create 一笔 `succeeded` Payment。
6. 更新 Order：`status='paid'`、`paidAt=now`、`providerTradeNo`、`providerStatus`、`providerConfigId/Version`、`providerPaidAt`、`checkoutValue=''`、`lastError=null`、`stockReserved=false`；库存商品同时 `stockSold++ / stockReserved--`。
7. 计算 `grantedCredits` 并发放积分：按下单时 `OrderItem.grantTypeSnapshot` 判定 `manual` 跳过；仅历史空快照回退当前商品配置，禁止让运营事后修改商品发放方式追溯改变订单。
8. 事务外执行营销副作用与会员激活（沿用现有代码），失败不回滚入账。

并发重复回调可能同时通过第 1 步查重；最终由 Payment `payTransactionId` 唯一约束裁决。捕获 Prisma `P2002` 后返回幂等成功，不能把重复通知抛成 500。

#### 20.8.2 `PaymentNotificationService`

```ts
@Injectable()
export class PaymentNotificationService {
  /** 验签 → 落收件箱 → 同步处理一次 → 返回适配器 ack */
  ingest(input: {
    providerId: PaymentProviderId;
    configId: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    body: Record<string, unknown>;
  }): Promise<PaymentAck>;

  /** worker 重试；claim 成功才处理 */
  retry(notificationId: string): Promise<'processed' | 'retry' | 'dead'>;
}
```

落库与处理：

1. 用 `PaymentConfigService.byId(configId)` 取固定版本；不存在或渠道不符 → 适配器 ack 失败。
2. `verifyNotification()` 失败 → 不落库，ack 失败。
3. 计算 `providerEventId = result.eventId || sha256(providerId + ':' + rawBody)`；create 收件箱行；唯一冲突按已存在处理（重复通知仍 ack 成功）。
4. 同一事件同步执行一次：按 `orderNo` 查订单 → 校验 configId 与订单一致（历史空配置除外）→ `applyPaymentResult()`。
5. 业务终态（已入账、已关闭、金额不符、订单不存在）写结果并 `processed`；金额不符/订单不存在同时写新对账系统的差异项。
6. 基础设施失败：`attempts++`、`status='failed'`、`nextAttemptAt=now+backoff`，**ack 失败**让渠道重试；worker 也会继续补。

退避：1min、5min、15min、1h，最多 8 次；超过后 `failed` 且 `nextAttemptAt` 推到远期，后台对账页显示异常。进程崩溃残留的 `processing` 5 分钟后回收为 `failed`。

#### 20.8.3 `PaymentReconciliationService`

```ts
@Injectable()
export class PaymentReconciliationService {
  run(input: {
    providerId: PaymentProviderId;
    billDate: string;
    retryFailed?: boolean;
    actorId: string;
  }): Promise<{ run: RunView; reused: boolean }>;

  list(query: ReconciliationListQueryDto): Promise<PageResult<RunView>>;

  items(
    runId: string,
    query: ReconciliationItemQueryDto,
  ): Promise<{
    run: RunView;
    items: ItemView[];
    total: number;
    page: number;
    pageSize: number;
  }>;

  importCsv(input: {
    providerId: PaymentProviderId;
    billDate: string;
    file: Buffer;
    fileName: string;
    actorId: string;
  }): Promise<{ run: RunView }>;
}
```

比对规则（每笔账单记录独立处理，网络调用不包在大事务里）：

| 情况 | result | 动作 |
| --- | --- | --- |
| 本地有单，订单已 paid，交易号与金额一致 | `matched` | 无 |
| 本地 pending，渠道账单显示成功 | `recovered` | 先用固定配置 `queryOrder()` 二次确认，再 `applyPaymentResult()` |
| 二次查单未确认/本地入账失败 | `credit_failed` | 不补发，记录原因 |
| 本地无该订单号 | `local_order_not_found` | 不创建订单，不补发 |
| 本地有 paid 单，账单无记录 | `provider_record_missing` | 不降级，记录 |
| 金额不一致 | `amount_mismatch` | 不入账 |
| 渠道交易号与本地不一致 | `trade_no_mismatch` | 不入账，需人工核对 |
| 本地已取消但账单成功 | `credit_failed` | 不通过 `markPaid` 强行改 cancelled；detail 提示人工退款/补单 |

计数在全部记录处理完后一次性回写；每个 item 的 create 与最终计数更新各自短事务，避免 1000 条账单长时间持锁。`(runId, merchantOrderNo, providerTradeNo)` 唯一，既保证重复解析不会重复补发，也允许同一商户订单号的多条渠道流水（如重复扣款）分别留痕。自动补发只走签名查单，不直接相信上传 CSV 的「成功」字样。

#### 20.8.4 `PaymentWorkerService`

```ts
const TICK_MS = 15_000;

@Injectable()
export class PaymentWorkerService implements OnModuleInit, OnModuleDestroy {
  onModuleInit(): void;     // 启动后 15s 起跑，不阻塞 Nest 启动
  onModuleDestroy(): void;  // clearTimeout
  tick(): Promise<void>;    // 测试直接调用
}
```

`tick()` 串行执行，任一步失败只记日志，不中断后续：

1. 回收超过 5 分钟的 `processing` 通知。
2. 处理最多 50 条到期通知（`pending/failed` 且 `nextAttemptAt<=now`）。
3. 关闭最多 50 笔 `pending` 且 `expiresAt<=now` 的订单；走 `PaymentOrderService.close({ actor:'worker' })`，不得直接 `updateMany` 改 cancelled。
4. 每 30 秒（`lastQueriedAt < now-30s`）查最多 20 笔未过期 pending 订单；已支付则入账。
5. 本地时间 10:15 后，若当日尚未尝试，则对昨日已启用且支持对账的渠道各跑一次 `ReconciliationService.run()`；单渠道失败写 run，不阻塞下一渠道。

单实例串行；若未来多实例，增加数据库租约表或把 worker 拆成独立进程，不能仅靠内存锁。`PAYMENT_WORKER_ENABLED=false` 仅用于测试/排障，默认 true；该开关不改变接口行为。

#### 20.8.5 下单时的商品校验与库存

`OrderService.create()` 在现有金额计算前增加：

1. 取全部商品后校验 `kind='credits'`、`status='active'`、币种一致；混合币种订单直接 `40001`。
2. `saleStrategy='timed'`：当前时间必须在窗口内；`inventory`：`stockTotal - stockSold - stockReserved >= quantity`；`periodic`：统计窗口内非 cancelled 订单数 + quantity <= limit。
3. 库存占用与订单创建放进同一事务，用条件 SQL 防并发超卖：

```sql
UPDATE "Product"
SET "stockReserved" = "stockReserved" + ?
WHERE id = ?
  AND status = 'active'
  AND "stockTotal" - "stockSold" - "stockReserved" >= ?
```

受影响行数为 0 → `40001`「库存不足」并回滚。Order 的 `stockReserved=true` 仅在至少一个库存商品成功占用时置位。

4. 订单币种取商品 `currency`；会员单固定 `CNY`。
5. 订单创建成功后，响应里带 `saleStatus` 变化与 `couponWarning`，不额外返回库存细节。

取消/超时释放库存：`releaseReservation(orderId)` 幂等，按 `OrderItem.stockReservedSnapshot` 回加 `stockReserved--`，并把 `Order.stockReserved` 置 false。支付成功时在 `markPaid` 事务内按同一快照把占用转成已售；即使运营在待支付窗口内修改 `Product.saleStrategy`，也不影响已创建订单的库存账。该 helper 放在 `OrdersModule`，支付层只调用 `OrderService`，不直接写库存。

限量券与库存采用相同的预留语义：`Coupon.usedCount` 仍是支付成功口径，但可用名额按 `usedCount + pending 订单数` 计算。建单事务先锁 Coupon 行、再复查总量和每人限额；如果最后一个名额已被其他 pending 单占用，则降级为活动/原价并返回 `couponWarning`，不阻断下单。支付事务先锁同一 Coupon 行，再置订单 `paid` 并递增 `usedCount`，取消/超时订单离开 pending 后自动释放预占。
