# 支付域重构与后台「支付充值」页实施方案

> **UI 前提**：后台 UI 为 shadcn（页面只从 `admin-ui/primitives` 取件，见 `docs/admin-ui-design.md`）。接口、数据流与业务约束不受影响。
>
> 状态：**部分实施（基线 commit 505319c）**。后端支付域主链路已落地；C 端支付方式选择、后台 `/admin/payments` 页面、存储商品与部分可靠性/测试项仍待补齐，详见 §25。
> 目标页面：`/admin/payments`，以 `open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx` 为交互与信息架构基准。
> 参考后端：`open-ai-canvas/backend/internal/app/payment*.go`、`backend/internal/repository/payment.go`、`backend/payment-plugins/`。
>
> 本文只写目标方案与落地顺序；与代码冲突时以代码为准。所有现状判断均已对照本仓库代码核对（见 §2 的 file:line）。

---

## 0. 结论与已定决策

先把会影响实现的决策定下来，避免开发阶段反复改表：

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **不新建 `PaymentOrder` 表**，复用 `Order` + `Payment`，在 `Order` 上补支付编排字段 | 本仓库的 `Order` 已承载优惠券、活动、会员、退款、发票、积分回收，另建支付订单会复制这整条资金链路，并让退款出现两套入口 |
| D2 | 支付渠道配置**加密落库、不可变版本化**；订单固定 `providerConfigId + version`；回调 URL 带 `configId` | 换密钥后旧订单的回调仍必须能验签；参考实现正是把 configId 放进 notify URL |
| D3 | 渠道白名单由**适配器注册表**定义，不读环境变量；缺字段一律 503，不降级沙箱 | 与现有 `PaymentProviderFactory` 的安全铁律一致，但把配置来源从 env 换成版本化配置 |
| D4 | 新增权限点 `payment.write`（渠道配置，高危）与 `payment.operate`（查单/关单）；`payment.read` 继续读；对账沿用 `finance.reconcile` | 与现有权限矩阵对齐：财务可改钱，运营只读排障 |
| D5 | 新增 `/admin/payments` 四标签页；`/admin/payment-channels`、`/admin/reconciliation` 改为重定向 | 同一份渠道/对账数据不保留两套入口；旧书签与告警深链不 404 |
| D6 | 积分为**整数**（复用 `Product.credits`），不引入微积分；币种默认 CNY，USD 仅在存在声明支持 USD 的渠道时允许上架 | 本仓库积分域与结算全是整数；没有 USD 通道时放开 USD 等于卖不出去的商品 |
| D7 | 存储扩容商品（`kind=storage`）**不进本轮**，页面保留该选项但禁用并说明原因 | 本仓库没有存储配额与上传容量校验，先做会变成「卖了容量但不限流」的假功能 |
| D8 | 支付通知收件箱 + **独立 15s worker**；不复用 10 分钟一次的 `SchedulerService.tick()` | 现有调度间隔是 10 分钟（`scheduler.service.ts:11`），用它消费回调会把「已付款」晾十分钟 |
| D9 | 对账新建 `PaymentReconciliationRun/Item`，旧 `ReconciliationBatch/Item` 停止写入 | 新模型需要「每个渠道每天一次运行、自动补发、失败原因」；旧模型是人工导入批次，语义不同 |
| D10 | 后台页面使用本仓库 shadcn + `admin-ui` 原语，**不引入 antd** | 后台 34 页已统一为 shadcn；参考页的 antd 组件只作为交互参照，不照搬实现 |

> 仍未定的两项（建议按上表执行，评审时只需确认）：
> 1. **USD 商品是否本轮开放**：建议开放字段与校验，但没有支持 USD 的渠道时前后端都拒绝上架/支付；
> 2. **支付宝账单 ZIP 解析**：建议引入无原生依赖的 `fflate`（MIT），或先只支持微信 CSV + 手工 CSV 导入，二期再补支付宝 ZIP。

---

## 1. 目标与非目标

### 1.1 目标

1. **多渠道并存**：沙箱、支付宝、微信可同时启用；用户在结算页选择支付方式。
2. **渠道配置可运营**：后台维护密钥、网关、回调基址；密文落库、版本化；历史订单固定使用下单时的版本。
3. **订单可运维**：后台查单、关单；关单前先查单，渠道已支付则立即入账，避免「钱收了、单还挂着」。
4. **回调可靠**：验签后先落持久化收件箱，再异步入账；重复回调、进程重启、短暂数据库故障都不丢单。
5. **T+1 对账闭环**：按渠道下载账单，逐笔比对；已支付未入账的订单经签名查单二次确认后自动补发；其余差异留痕。
6. **页面完整复刻**：`/admin/payments` 四个标签页、表格列、抽屉、筛选、分页、导出、空/错/加载态与参考页一致；交互改用本仓库组件语言。

### 1.2 非目标

| 项 | 原因 |
| --- | --- |
| 存储空间扩容商品 | 缺配额模型；Phase 5 与存储配额子系统一起做 |
| 易支付 / 虎皮椒 / 支付FM 等聚合通道 | 每家的下单、验签、查单、账单协议都不同；先把支付宝/微信打通，再按 `PaymentAdapter` 扩展 |
| 重写退款 | 现有 `OrderService.refund()` 已是「先落退款单、再调渠道、成功才动本地账」；本次只把渠道配置来源换成版本化配置，并把配置版本固定到退款 |
| 会员套餐并入充值商品 | 会员是周期权益，留在 `/admin/membership-plans` |
| 发票域 | 独立模块，不随支付重构调整 |

---

## 2. 现状审计（已核对）

### 2.1 当前链路

```
OrderService.create()                      订单快照 + 优惠 + 幂等键        order.service.ts:92
  └─ PaymentsService.createIntent()        取「唯一生效通道」预下单        payments.service.ts:51
       └─ PaymentProviderFactory.active()  读 PAYMENT_PROVIDER + env       payment.factory.ts:65
  └─ POST /payments/callback/:channel      验签 → 金额核对 → markPaid     payments.service.ts:173
       └─ 差异写旧 ReconciliationBatch(fileName='(callback)') + Item
  └─ GET /payments/:orderId/status         轮询本地 Payment 流水           payments.service.ts:133
  └─ OrderService.cancelExpired()          只改本地状态，不查单/关单        order.service.ts:998
```

### 2.2 关键现状

| 位置 | 现状 | 本次影响 |
| --- | --- | --- |
| `payments/payment-provider.interface.ts:18` | 通道白名单硬编码 `sandbox / alipay / wechat`；接口只有 `createIntent / refund / verifyCallback / ack` | 缺 `queryOrder / closeOrder / downloadTradeBill` |
| `payments/payment.factory.ts:65` | `active()` 只取环境变量声明的**单一**通道；缺凭据 503 | 需要按 `providerId` 取适配器，而不是全局唯一 |
| `payments/payments.service.ts:51` | 建意图不接受渠道参数 | C 端无法选择支付方式 |
| `payments/payments.service.ts:173` | 回调同步入账，无收件箱、无重试 | 数据库瞬断/进程重启会丢已验签通知 |
| `payments/payments.service.ts:268` | 差异写旧 `ReconciliationBatch/Item` | 新对账模型并行后会两处各写一份 |
| `orders/order.service.ts:444` | `markPaid()` 是唯一入账路径；已处理积分、会员、券、通知 | 保留为唯一入账路径，增加金额/币种/交易号幂等参数 |
| `orders/order.service.ts:998` | 超时直接 `cancelled` | 必须先查单再关单 |
| `admin/reconciliation.service.ts:41` | 对账只支持人工上传 CSV | 缺渠道账单下载与自动补发 |
| `admin/payment-channels.controller.ts:31` | 渠道页只读，凭据来自环境变量 | 要改成可配置、可版本化 |
| `frontend/src/pages/admin/AdminPaymentChannelsPage.tsx:60` | 只读状态页 | 由 `/admin/payments?tab=providers` 取代 |
| `frontend/src/pages/admin/AdminReconciliationPage.tsx:88` | 批次导入 + 差异处置 | 由 `/admin/payments?tab=reconciliation` 取代 |
| `frontend/src/components/admin/adminNav.ts:82` | 「财务」组有支付渠道 / 渠道对账两项 | 合并为「支付充值」 |
| `admin/scheduler.service.ts:11` | `TICK_MS = 10 分钟` | 支付通知不能等 10 分钟；需独立 worker |
| `model/infra/secret-cipher.ts:28` | AES-256-GCM，`enc:v1:` 前缀，ModelModule 导出 | 抽到 common 层，支付域复用，避免依赖整个模型域 |
| `main.ts:49,66` | `bodyParser:false` 且保留 `rawBody` | 微信/支付宝验签所需能力已具备 |

### 2.3 数据模型现状

- `Order` 已有 `status / channel / paidCents / expiresAt / paidAt`，**没有** `currency`、`providerConfigId`、`checkoutValue`、`providerTradeNo`、`closeStartedAt`。
- `Payment` 已有 `payTransactionId @unique / channel / status(pending|succeeded|failed|closed) / rawPayload`；沙箱失败已经会写 `failed` 流水（`order.service.ts:390,407`）。
- `Product` 已有 `priceCents / credits / creditsValidDays / status(active|offline) / sortOrder / grantType`；**没有** `currency / kind / saleStrategy / 库存 / 限时`。
- 旧对账表 `ReconciliationBatch / ReconciliationItem` 已存在，状态是 `open/resolved/ignored`。

### 2.4 缺口清单

1. 同一时间只能一个通道；C 端无法选择支付方式。
2. 凭据只能改环境变量并重启；后台不能维护，也没有版本。
3. 无查单/关单；超时直接本地取消。
4. 回调同步处理，无持久化收件箱。
5. 对账依赖人工 CSV，无账单下载、无自动补发。
6. 商品无币种、上架策略、库存、限时。
7. 页面只有只读渠道状态 + 人工对账两页，缺商品、订单两个标签。

---

## 3. 参考实现与本仓库的映射

参考实现是 Go + 独立 `PaymentOrder/TopupProduct` 模型；本仓库是 NestJS + Prisma，且交易域已经存在。**照搬表结构会破坏现有退款/会员/发票链路**，因此按能力映射，不按表名映射：

| 维度 | open-ai-canvas | 本仓库方案 | 说明 |
| --- | --- | --- | --- |
| 支付订单 | 独立 `PaymentOrder` | `Order` + `Payment` | 复用订单状态机、优惠快照、退款、发票、积分回收 |
| 支付尝试 | 订单自身状态 + 通知 | `Payment` 行（pending/failed/succeeded/closed） | 保留「一次发起一条流水」的可追溯性 |
| 商品 | `TopupProduct`（微积分） | 扩展 `Product`（整数积分） | 不复制商品域；`/admin/products` 仍是全量管理入口 |
| 渠道 | 宿主插件 + `payment-plugins` | 适配器注册表 `payments/adapters/` | 本仓库没有支付插件运行时，模型插件是模型协议，不能混用 |
| 配置 | `PaymentProviderConfig` 加密版本化 | 同名新表 | 语义一致 |
| 回调 | `/api/payments/notify/:provider/:configId` | `/api/v1/payments/callback/:channel/:configId` | 回调必须能定位到下单时的配置版本 |
| 后端 worker | 15s 独立循环 | 15s `PaymentWorkerService` | 不用 10 分钟的调度器 |
| 对账 | `PaymentReconciliationRun/Item` | 同名新表，替换旧批次表 | 旧表只读保留一个版本周期 |
| 后台 UI | antd + 自定义 admin-ui | shadcn + `admin-ui` | 视觉语言按本仓库，不引 antd |
| 退款 | 本页不提供 | 保留在订单管理 | 参考页的「平台不提供支付退款」提示需改写（本仓库有退款） |
| 存储商品 | 支持 | 本轮不做，选项禁用 | 缺配额子系统 |

---

## 4. 目标架构

### 4.1 分层

| 层 | 职责 | 不做什么 |
| --- | --- | --- |
| `PaymentsController` | HTTP 入参、公开回调、按配置版本路由 | 不改订单状态 |
| `PaymentsService` | 建意图、验签编排、查单/关单编排 | 不直接发积分 |
| `PaymentAdapter` | 单渠道协议：下单/查单/关单/验签/账单/退款 | 不知道订单与积分 |
| `PaymentConfigService` | 配置版本、加密、解密、启停、字段元数据 | 不发起支付 |
| `OrderService` | 订单状态机、`markPaid()` 唯一入账路径、退款 | 不拼渠道协议 |
| `PaymentReconciliationService` | 账单比对、二次查单确认、补发调用 | 不直接改钱；补发仍走 `markPaid()` |
| `PaymentWorkerService` | 收件箱重试、过期关单、pending 补查、每日对账 | 不做业务判定 |

### 4.2 适配器接口

新增 `backend/src/payments/adapters/`：

```
adapters/
├── payment-adapter.interface.ts
├── sandbox.adapter.ts
├── alipay.adapter.ts
├── wechat.adapter.ts
└── index.ts                 # PAYMENT_ADAPTERS 注册表
```

```ts
interface PaymentAdapterDescriptor {
  id: string;                          // 'sandbox' | 'alipay' | 'wechat'
  name: string;                        // 后台展示名
  checkoutMode: 'redirect' | 'qrcode' | 'sandbox';
  /** 后台配置表单字段；前端不写死渠道字段 */
  configFields: PaymentConfigField[];
  supportedCurrencies: string[];       // 支付宝/微信：['CNY']
  supportsReconciliation: boolean;
}

interface PaymentAdapter {
  readonly descriptor: PaymentAdapterDescriptor;
  validateConfig(values: Record<string, string>): string[];
  createOrder(input: CreateOrderInput): Promise<Checkout>;
  queryOrder(input: QueryOrderInput): Promise<ProviderPaymentResult>;
  closeOrder(input: CloseOrderInput): Promise<ProviderPaymentResult>;
  verifyNotification(input: NotificationInput): Promise<NotificationResult>;
  ack(result: NotificationResult): PaymentAck;
  downloadTradeBill?(input: BillInput): Promise<BillRecord[]>;
  refund(input: RefundInput): Promise<RefundResult>;
}
```

约束：

- 适配器**不读 `process.env`**；所有凭据由调用方传入解密后的 `values`。
- 缺字段由 `validateConfig` 返回字段名，调用方转 `50301`，**绝不降级为沙箱**。
- 渠道白名单只在 `PAYMENT_ADAPTERS` 定义；新增渠道只加一个文件与数组项。
- 沙箱在生产环境由 `availableProviders()` 强制过滤，即使配置启用也不可选。

### 4.3 配置版本

`PaymentProviderConfig` 不可变：每次保存新增一版，`(providerId, version)` 唯一。订单在下单时固定 `providerConfigId / providerConfigVersion / providerId(=Order.channel)`。

保存流程：

1. 校验 `enabled`、`closeAfterMinutes`（5–1440）、字段必填与格式（`validateConfig`）。
2. 合并旧值：未提交的密钥字段沿用当前版本密文（参考页的「已配置，留空保持不变」）。
3. 对整个 `values` JSON 加密（AES-256-GCM），落 `configCipher`；同时落 `configDigest`（sha256）用于判断是否重复保存。
4. `version = max(version) + 1`；写审计 `payment.provider_config_save`。
5. 读取时解密，只回传非密钥字段；密钥字段回 `secretConfigured: true` 与掩码，**永不回传明文**。

`SecretCipher` 从 `model/infra/` 抽到 `common/security/`，做成全局模块；`ModelModule` 继续 re-export，模型域调用点不改。`MODEL_SECRET_KEY` 语义不变：模型与支付凭证共用该密钥，轮换会使两者密文同时失效（写进 `.env.example` 与 NOTICE）。

### 4.4 订单与支付尝试

不新建 `PaymentOrder`。在 `Order` 上补支付编排字段，在 `Payment` 上补配置版本与关单信息。

- 一个订单同一时刻只有一个进行中的支付意图；再次发起时先关闭旧的 pending 尝试。
- 每次发起支付写一条 `Payment(status='pending')`；下单失败写 `failed` + `Order.lastError`；回调/查单成功把该 pending 行更新为 `succeeded`（没有 pending 行时新建，兼容沙箱/手工核销）。
- `Payment.payTransactionId` 保持唯一，继续作为重复回调去重键。
- 入账仍只走 `OrderService.markPaid()`；`markPaid` 增加 `providerConfigId / providerTradeNo / providerPaidAt` 入参，并在事务内设置 `Order.providerTradeNo / providerPaidAt / paidAt`。
- 关单把 pending 尝试置 `closed`，订单置 `cancelled` 并写 `closedAt`。

页面状态是**派生值**，不写进 `Order.status`：

| 页面状态 | 判定 | 文案 |
| --- | --- | --- |
| `created` | `Order.status='pending'` 且无 `checkoutValue`、无 `lastError` | 创建中 |
| `pending` | `Order.status='pending'` 且有 `checkoutValue` | 待支付 |
| `closing` | `Order.status='pending'` 且 `closeStartedAt` 在 2 分钟内 | 关单中 |
| `create_failed` | `Order.status='pending'` 且 `lastError` 非空、`checkoutValue` 为空 | 下单失败 |
| `closed` | `Order.status='cancelled'` | 已关闭 |
| `credited` | `Order.status='paid'` | 已入账 |
| `refunded` / `partial_refunded` | `Order.status` 对应值 | 已退款 / 部分退款 |

> 参考页没有退款两态；本仓库有退款，不映射会让退款单在支付页显示成「已入账」，属于误导。

`status` 查询的 SQL 映射（`PaymentAdminService.listOrders`）：

| 筛选值 | Prisma where |
| --- | --- |
| `created` | `status:'pending', checkoutValue:'', lastError:null, closeStartedAt:null` |
| `pending` | `status:'pending', checkoutValue:{not:''}, closeStartedAt:null` |
| `closing` | `status:'pending', closeStartedAt:{not:null}` |
| `create_failed` | `status:'pending', lastError:{not:null}, checkoutValue:''` |
| `closed` | `status:'cancelled'` |
| `credited` | `status:'paid'` |
| `refunded` | `status:{in:['refunded','partial_refunded']}` |

### 4.5 回调收件箱与 worker

回调路径改为 `POST /payments/callback/:channel/:configId`（`configId` 是下单时固定的配置行 id）：

1. 按 `configId` 取配置，校验 `providerId` 与 `channel` 一致；不存在或已停用 → 失败响应。
2. 适配器用该版本 `values` 验签；失败直接回渠道失败，不落库。
3. 归一出 `merchantOrderNo / providerTradeNo / amountCents / currency / paid / closed / paidAt / providerStatus / eventId`。
4. 按 `merchantOrderNo` 查订单；订单不存在、`Order.providerConfigId !== configId`、金额/币种不符 → 落 `PaymentNotification(status='failed')` + 对账差异，回渠道失败（让其重试）。
5. 以 `(providerId, eventId)` 唯一写入 `PaymentNotification`（原始报文加密、摘要落库）。重复事件直接回成功。
6. 立即尝试处理；失败保留 `pending`，worker 按指数退避重试。
7. 应答格式由适配器 `ack()` 决定（支付宝纯文本 / 微信 JSON）。

收件箱终态：

| 情况 | 处理 | 应答 |
| --- | --- | --- |
| 验签失败 | 不落库，日志告警 | 失败 |
| 订单不存在 | 收件箱 `failed` + 对账差异 | 失败（渠道重试，人工核对） |
| 配置版本不匹配 | 收件箱 `failed` + 告警 | 失败 |
| 金额/币种不符 | 收件箱 `failed` + 对账差异 | 失败（不做本地入账） |
| 订单已入账 | 幂等确认，不改状态 | 成功 |
| 订单已关闭但收到成功回调 | 对账差异 + 告警 | 失败 |

`PaymentWorkerService`（`OnModuleInit/OnModuleDestroy`，单实例，15 秒）：

- `drainNotifications()`：每次 32 条，失败按 `2^attempts * 5s` 退避。
- `reconcileExpiredOrders()`：抢占 `status='pending' && expiresAt<=now && closeStartedAt=null` 的订单，先查单再关单。
- `queryPendingOrders()`：`status='pending' && (lastQueriedAt=null || lastQueriedAt < now-30s)`，每次 32 条。
- `maybeRunDailyReconciliation()`：每 30 分钟检查，10:15 后只跑昨日账单；`(providerId,billDate)` 唯一，30 分钟内失败不重试。
- 在 `SchedulerService.taskStatus()` 中登记 worker 状态，并允许 `runNow` 手动触发，便于值班排障；**不要**把 15 秒任务塞进 10 分钟的 `tick()`。

### 4.6 对账

新增 `PaymentReconciliationRun / Item`，替代旧 `ReconciliationBatch / Item`：

- `run` 唯一键 `(providerId, billDate)`，状态 `running / completed / failed`。
- `source = 'provider' | 'csv'`：渠道账单下载为主，CSV 导入保留给不支持账单下载的渠道与人工兜底。
- 比对结果：
  - `matched`：账单有、本地已入账、金额与交易号一致。
  - `recovered`：账单有、本地未入账，**签名查单确认已支付且金额/交易号一致**后自动入账并补发权益。
  - `local_order_not_found`：账单有、本地订单不存在。
  - `provider_record_missing`：本地已入账、账单无记录。
  - `amount_mismatch`：金额或币种不一致。
  - `trade_no_mismatch`：交易号不一致。
  - `credit_failed`：确认已支付但补发失败（重试或人工）。
- **账单只是线索，不是入账授权**：任何自动补发前必须调用 `queryOrder()` 并校验 `paid / amount / currency / tradeNo`。
- 处置不改钱：`resolved` 只标记；补发失败的人工处理仍回订单流程。
- 渠道账单：
  - 支付宝：`alipay.data.dataservice.bill.downloadurl.query` 取 URL，下载 ZIP 后解压 CSV；
  - 微信 v3：`/v3/bill/tradebill` 取下载地址，CSV 直读。
- 旧 `ReconciliationBatch/Item` 在 Phase 3 完成后停止写入；旧页面重定向；告警中心、值班带、后台搜索中的 `/admin/reconciliation` 链接同步改到 `/admin/payments?tab=reconciliation`。

---

## 5. 数据模型（Prisma）

> SQLite；不新增 enum，状态继续 `String` + service 白名单。新增字段一律可空或有默认值，`prisma db push` 可直接升级。

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

### 5.3 扩展 `Payment`

```prisma
  currency              String   @default("CNY")
  providerConfigId      String?
  providerConfigVersion Int?
  providerStatus        String?
  lastError             String?
  closedAt              DateTime?
```

`status` 继续用 `pending | succeeded | failed | closed`；补 `@@index([orderId, status])`。

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

### 5.7 站点设置

`backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` 增加：

- `payment.defaultCurrency`：默认 `CNY`，可选 `CNY / USD`，`group: 'payment'`，`public: true`（C 端充值面板也需要）。
- 同步 `SETTING_GROUP_LABELS` 增加 `payment: '支付'`。

---

## 6. 接口契约

统一响应信封与错误码沿用 `docs/api-contract.md`。

### 6.1 C 端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/payments/providers` | 可用渠道（`enabled && configured` 且支持订单币种），返回 `id / name / checkoutMode / icon` |
| POST | `/payments/:orderId/intent` | Body `{ providerId }`；下单并固定配置版本；返回 `mode / payUrl / codeUrl / expiresAt / sandbox` |
| GET | `/payments/:orderId/status` | 本地状态；`pending` 且 `lastQueriedAt` 超过 2s 时触发一次渠道查单 |
| POST | `/payments/:orderId/query` | 主动查单（前端「刷新支付状态」） |
| POST | `/orders/:orderId/cancel` | 未支付取消；已固定渠道时先查单再关单，渠道已支付则转已支付并返回 409 提示 |

`POST /orders` 不变（商品/会员、优惠、幂等键）。`intent` 的 `providerId` 在只有一个可用渠道时可省略，由服务端取唯一可用项；多个可用且未传 → `40001`。

### 6.2 后台 `/api/v1/admin/payments`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/providers` | `payment.read` | 渠道列表 + 当前配置版本 + 字段元数据 + `secretConfigured` |
| PUT | `/providers/:id/config` | `payment.write` | 保存新版本；高危审计 |
| GET | `/settings` | `payment.read` | 默认充值货币 |
| PUT | `/settings` | `payment.write` | 修改默认货币 |
| GET | `/products` | `product.read` | 充值商品列表（含上架状态计算） |
| POST | `/products` | `product.write` | 新建商品（内部走 `AdminCommerceService`） |
| PUT | `/products/:id` | `product.write` | 修改商品（内部走 `AdminCommerceService`） |
| GET | `/orders` | `payment.read` | 支付订单分页：`status / keyword / providerId / timeField / from / to / page / pageSize` |
| GET | `/orders/export.csv` | `payment.read + data.export` | 同筛选导出，上限 10000 |
| GET | `/orders/:id` | `payment.read` | 支付订单详情 |
| POST | `/orders/:id/query` | `payment.operate` | 空请求体；向渠道查单并应用结果，自动写审计 |
| POST | `/orders/:id/close` | `payment.operate` | 空请求体；先查单，已支付则入账；否则关单，自动写审计 |
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

### 6.3 导出格式

沿用 `common/csv-response.ts` 的 BOM + `Content-Disposition`：

- 订单：订单号、用户、邮箱、商品、渠道、金额、币种、权益、状态、配置版本、渠道交易号、创建/支付/入账/关闭时间。
- 对账汇总：账单日期、渠道、状态、总笔数、一致、补发、异常、错误、完成时间。
- 对账明细：结果、商户订单号、渠道交易号、金额、币种、说明。

---

## 7. C 端支付流程

### 7.1 结算页 `CheckoutPage.tsx`

1. 加载可用渠道：`GET /payments/providers`。
2. 多渠道时渲染支付方式卡片（品牌图标 + 名称 + 扫码/跳转标识）；单渠道自动选中。
3. 沙箱保留显式声明「不产生真实扣款」；生产环境不返回沙箱。
4. 发起支付传 `providerId`：
   - `redirect` → `window.location.href = payUrl`；
   - `qrcode` → 用现有 `qrcode` 库渲染二维码；
   - `sandbox` → 保留站内模拟面板（仅开发/测试）；
   - `free` → 0 元单直接成功。
5. 轮询 `status`；本地 pending 超时提示重新发起；渠道失败原样展示。
6. 继续支付（`?orderId=`）复用既有订单，并预选 `order.channel`（若仍可用）。

### 7.2 商品页 `PackagesPage.tsx`

- 商品卡展示币种、售罄/待发售/已结束/限时。
- 不可购买时禁用按钮并给出原因（库存不足 / 未到发售时间 / 周期次数已用完 / 已下架）。
- 不展示 USD 商品，除非存在可用 USD 渠道；否则商品卡显示「暂无可用的美元支付渠道」。

### 7.3 订单页 `OrdersPage.tsx`

- 「继续支付」跳到结算页并携带 `orderId`；渠道不可用时提示重新选择。
- 状态文案补「关单中」「下单失败」「已退款」「部分退款」。

---

## 8. 后台页面规格：`/admin/payments`

### 8.1 页面骨架（与参考页一致）

- 标题：**支付充值**
- 描述：**管理系统支付适配器、充值商品、支付订单与 T+1 对账**
- 右上角：刷新（按当前标签页重载；加载中显示 loading）
- 顶部提示条（info）：**平台不提供支付退款** → 本仓库改写为：**本页不提供退款；退款请到订单管理。管理端提供查单、关单和对账。关单前始终先向渠道查单；对账发现已支付未入账订单时会幂等补发积分。**
- 四个标签：`支付渠道` / `充值商品` / `支付订单` / `支付对账`
- URL 同步：`?tab=providers|products|orders|reconciliation`，默认 `providers`；`?tab=reconciliation&runId=<id>` 可直接打开明细抽屉（告警深链），`?tab=orders&orderId=<id>` 可直接打开订单详情。
- 页面内容区沿用 `.adm-content`（不限宽，铺满可用宽度）；宽表由 `AdminDataTable` 的 `minWidth` 提供横向滚动。

### 8.2 支付渠道标签

参考页列 → 本仓库列：

| 列 | 内容 | 数据来源 |
| --- | --- | --- |
| 支付渠道 | 品牌图标 + 名称 + `providerId` 等宽小字 | `GET /admin/payments/providers` |
| 支付方式 | 扫码支付 / 网站跳转 / 站内模拟 | `checkoutMode` |
| 状态 | `可用/不可用`；副行 `配置已启用/已停用 · 密钥已配齐/缺 N 项`（`missing.length`） | `enabled && configured` |
| 未支付自动关闭 | `{closeAfterMinutes} 分钟`（空值显示 30） | 配置版本 |
| 配置版本 | `v{version}` / `未配置` | 最新版本 |
| 操作 | `配置` 按钮 | 打开配置抽屉 |

渠道页顶部（参考页没有，但本仓库已有且必须保留）：

- `Notice tone="danger|warn"`：生产仍走沙箱、当前渠道缺凭据、未配 `PAYMENT_NOTIFY_BASE`。
- `StatCard` 三张：当前生效渠道 / 可用渠道数 / 运行环境（可选，放在表格上方，不改变四标签结构）。

配置抽屉（宽 620）：

1. `渠道配置启用`：`SwitchBox`。
2. `未支付订单自动关闭时间（分钟）`：`NumberInput`，5–1440，整数。
3. 动态字段：后端 `configFields` 渲染；`type=password` 或 `secret=true` 用密码输入，已配置时占位「已配置，留空保持不变」；`textarea` 多行；`options` 下拉。
4. 页脚：`保存新版本`；成功后 toast「已保存为新版本」并重载列表。
5. 说明条：密钥加密保存；历史订单固定使用下单时的配置版本。

字段元数据（首批）：

| 渠道 | 字段 |
| --- | --- |
| sandbox | 无必填 |
| alipay | `appId`、`sellerId`、`merchantPrivateKey`（secret）、`alipayPublicKey`（secret）、`gateway`（默认官方 gateway，仅允许官方生产/沙箱域名） |
| wechat | `appId`、`mchId`、`merchantSerialNo`、`merchantPrivateKey`（secret）、`apiV3Key`（secret，32 字节）、`wechatPayPublicKeyId`、`wechatPayPublicKey`（secret） |

### 8.3 充值商品标签

工具栏：

- 左：`默认充值货币` 下拉（CNY / USD），保存到 `payment.defaultCurrency`；保存中禁用。
- 右：`新增商品`（primary）。

表格列：

| 列 | 内容 |
| --- | --- |
| 商品 | 名称 + 说明（无说明显示「无说明」） |
| 售价 | `¥12.00` / `$12.00`（按 `currency` 格式化） |
| 权益 | `+100 积分`；`storage` 显示 `+50 GB · 30 天`（本轮选项禁用） |
| 排序 | `sortOrder` |
| 上架策略 | 不限量 / 周期 N 天 M 次 / 库存 剩余/总量 / 限时（待发售/进行中/已结束） |
| 状态 | 已停用 / 待发售 / 已结束 / 已售罄 / 销售中 |
| 操作 | 编辑 |

编辑抽屉（宽 520）：

- 名称（必填，≤120）、说明（≤500）。
- 商品类型：`积分充值` / `存储空间扩容`（编辑时不可改；storage 本轮禁用并提示「存储配额子系统未上线」）。
- 售价货币：CNY / USD；无可用 USD 渠道时仍可保存 `offline` 商品，但不能上架（`active` 时保存返回 `40001`）。
- 售价（元/美元，提交时换算为最小单位；前端只做展示换算，后端以 `priceCents` 为事实源）。
- 到账积分（整数，>0）。
- 积分有效期（天，0 = 永久）。
- 发放方式：`immediate`（支付成功即发）/ `manual`（后台手动发放；支付成功只入账，不发积分）。
- 上架策略：不限量 / 周期性 / 库存性 / 限时性；条件字段与参考页一致。
  - 周期：周期天数（1–3650）、周期内可购买次数（1–100000）。
  - 库存：平台总库存（≥ 已售 + 已占用）。
  - 限时：发售时间、结束时间（`datetime-local`）。
- 排序、`上架销售`。
- 类型创建后不可改；改类型需新建商品。

### 8.4 支付订单标签

工具栏：

- 搜索：名称、用户名（本仓库为 `User.name`）、邮箱、订单号、渠道交易号、完整用户 ID；回车查询。
- 筛选：订单状态、支付渠道、时间口径（创建/支付/入账）、日期范围。
- `查询` 按钮；筛选变更后显示「请先查询以应用筛选条件」。
- `导出 CSV`（同筛选，最多 10000 行；需要 `payment.read + data.export`）。

表格列（与参考页一致）：

| 列 | 内容 |
| --- | --- |
| 用户 | 姓名 + 邮箱；用户不存在显示「用户不存在」+ ID 片段 |
| 订单 / 商品 | 订单号（可复制，过长省略中间）+ 商品名（多商品显示首个 + `+N`） |
| 渠道 | 品牌图标 + 渠道名 |
| 金额 / 权益 | 金额 + `+N 积分` |
| 状态 | 创建中 / 待支付 / 关单中 / 已关闭 / 已入账 / 下单失败 / 已退款 / 部分退款 |
| 创建时间 | `MM-DD HH:mm`，悬停完整时间 |
| 操作 | `详情`；未终态显示 `同步状态`；仅 `created/pending/create_failed/closing` 显示 `关闭` |

详情抽屉（宽 680）：

- 用户、邮箱、用户 ID（可复制）、订单号（可复制）、渠道交易号（可复制）、商品、渠道、金额/权益、状态、配置版本。
- 时间线：创建、过期、支付、入账、关闭（无值显示 `--`）。
- 操作：`同步状态`、`关闭`（页面内 `ConfirmAction`，文案：系统会先查单，渠道已支付则立即入账，否则关单；不会退款）。

分页：默认每页 30，页码 + 每页条数。

### 8.5 支付对账标签

顶部执行区（`Panel`）：

- 渠道下拉（只列 `configured && supportsReconciliation` 的渠道；未配置或渠道本身不支持对账的不显示，sandbox 默认不参与）。
- 账单日期（不能选今天及以后，最多回溯 3 个月）。
- `执行对账`（需要 `finance.reconcile`）。
- 说明：系统每天 10:15 后自动对账昨日账单；也可在此手动重跑最近三个月。

运行列表：

| 列 | 内容 |
| --- | --- |
| 账单日期 | `YYYY-MM-DD` |
| 渠道 | 品牌图标 + 名称 |
| 状态 | 已完成 / 执行中 / 失败 |
| 一致 | `matchItems` |
| 自动补发 | `recoveredItems`（>0 高亮） |
| 异常 | `errorItems`（>0 高亮） |
| 完成时间 | 完整时间 |
| 明细 | `查看` |

明细抽屉（宽 `min(1080px, 94vw)`）：

- 结果筛选：全部 / 仅异常 / 具体结果。
- 列：结果、商户订单号（等宽）、渠道交易号、金额（含币种，如 `CNY 12.00`）、说明。
- 导出明细 CSV（仅 `completed` 可用）。
- 失败 run 显示错误提示条。
- 运行列表与明细各自分页（运行默认 30/页，明细默认 50/页）。

### 8.6 五态与交互约束

每个标签页都必须覆盖：

| 态 | 表现 |
| --- | --- |
| 首次空态 | `AdminDataTable` 的 `emptyText`：没有发现支付渠道 / 还没有充值商品 / 还没有支付订单 / 还没有对账记录 |
| loading | 表体骨架；已有数据时淡化而非整表消失 |
| 有数据 | 表格 + 分页 |
| 加载失败 | 首屏 `AdminListError`；已有数据 `AdminStaleError` 保留旧值 |
| 无权限 | 后端 403；前端 `can()` 隐藏写按钮，但后端仍是安全边界 |

不可逆操作：

- 关闭订单：页面内 `ConfirmAction`，必须写明「先查单，已支付则入账，否则关单；不会退款」。
- 保存渠道配置：高危权限，写审计日志，但不要求填写操作原因。
- 对账补发：由系统执行，不在页面直接提供「补发」按钮；人工处理走订单流程。

---

## 9. 关键规则

### 9.1 幂等

- 下单：`@@unique([userId, idempotencyKey])` 不变。
- 回调：`Payment.payTransactionId` 唯一；`PaymentNotification(providerId, eventId)` 唯一。
- 入账：`markPaid()` 先查交易号、再判订单状态；重复通知不重复发积分。
- 对账补发：同一 `(runId, merchantOrderNo)` 唯一；补发仍走 `markPaid()`，天然幂等。
- 关单：`closeStartedAt` 先抢占，避免 worker 与人工同时关单。

### 9.2 金额与币种

- 订单金额以 `Order.paidCents` 快照为准；回调金额必须相等，币种必须相等。
- 商品币种来自 `Product.currency`；订单落 `Order.currency`；`Payment.currency` 同值。
- 渠道 `supportedCurrencies` 不含订单币种时，下单前拒绝（`400`），不把美元单发给只收人民币的通道。

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

- 渠道密钥只以密文落库；接口永不回传明文；日志不打印密钥。
- 支付配置写入、关单、对账补发全部写审计。
- 公开回调不挂 JWT，只信验签；原始报文必须用 `rawBody`。
- 后台权限校验必须在后端；前端 `can()` 只隐藏按钮。
- 生产环境沙箱通道强制不可用：即使配置启用，`availableProviders()` 也过滤。
- 回调 URL 必须带 `configId`，否则换密钥后旧订单无法验签。

---

## 10. 迁移与兼容

### 10.1 数据库

- 使用 `prisma db push`（仓库现有流程），不写迁移脚本。
- 新表与新增字段全部可空/有默认值；旧数据无需回填。
- 旧 `ReconciliationBatch/Item` 保留只读，Phase 3 完成后标注 deprecated，下一轮再删除。
- 旧 `Order.channel` 值保持 `sandbox / alipay / wechat`；不新增 `providerId`。

### 10.2 环境变量

- `PAYMENT_PROVIDER` 保留为**首次启动的引导值**：若数据库没有任何 `PaymentProviderConfig`，启动时按该值生成 v1 配置（凭据从 env 读取一次），之后以数据库为准。
- `ALIPAY_*` / `WECHAT_*` 保留为引导凭据；后台保存后不再读取。
- `PAYMENT_NOTIFY_BASE` 保留（回调基址），配置页可展示但不在界面修改（避免把回调地址改到不可达域名）。
- `.env.example` 与 `docs/environments.md` 注明：引导完成后以数据库配置为准；`MODEL_SECRET_KEY` 同时保护模型与支付凭证。

### 10.3 前端路由

- 新增 `/admin/payments`。
- `/admin/payment-channels` → `/admin/payments?tab=providers`。
- `/admin/reconciliation` → `/admin/payments?tab=reconciliation`。
- `adminNav.ts`「财务」组：`支付充值`（`payment.read`）、`发票管理`；移除两个旧项。
- 告警中心、值班带、后台搜索中的旧链接同步改到新地址。

---

## 11. 实施批次

### Phase 0：基础（不改外部行为）

- `SecretCipher` 抽到 `common/security/secret-cipher.module.ts`；`ModelModule` re-export。
- Prisma：`PaymentProviderConfig`、`PaymentNotification`、`PaymentReconciliationRun/Item`；`Order/Payment/Product` 新字段。
- `payment-adapter.interface.ts` + `PAYMENT_ADAPTERS`；沙箱适配器迁移。
- `PaymentConfigService`（版本、加密、字段元数据、启停、引导 env）。
- `markPaid()` 增加可选 `providerConfigId / providerTradeNo / providerPaidAt`；默认行为不变。
- 闸口：`cd backend && npm run build`。

### Phase 1：渠道配置 + 支付渠道标签

- 支付宝/微信适配器改接收 `values`，不再读 env；补 `queryOrder / closeOrder / verifyNotification(config)`。
- 回调迁移到 `/payments/callback/:channel/:configId`；保留旧路由一版用于在途订单。
- 后台 `/admin/payments/providers`、`/settings`。
- 前端 `AdminPaymentsPage` 骨架 + 支付渠道标签 + 配置抽屉 + 风险提示。
- 闸口：`smoke-payments.js`（渠道状态、配置保存/掩码、回调）。

### Phase 2：支付订单 + worker

- `PaymentsService.createIntent(orderId, userId, providerId)`；写 pending 尝试、固定配置版本。
- `queryOrder / closeOrder`；`OrderService.cancelExpired()` 改为先查单再关单。
- `PaymentWorkerService`（15s）。
- 后台 `/admin/payments/orders`（列表/详情/查单/关单/导出）。
- C 端 `providers / intent(providerId) / query`；结算页多渠道选择；订单页继续支付。
- 前端支付订单标签 + 详情抽屉。
- 闸口：`smoke-payments.js` + 新 `smoke-payment-orders.js`。

### Phase 3：对账

- 渠道账单下载（支付宝 ZIP、微信 CSV）；CSV 兜底导入。
- `PaymentReconciliationService`：比对、二次查单确认、自动补发、失败留痕。
- 每日 10:15 自动对账 + 手动执行。
- 后台 `/admin/payments/reconciliations*`；前端支付对账标签 + 明细抽屉。
- 旧 `ReconciliationBatch/Item` 停止写入；告警/导航切换。
- 闸口：新 `smoke-payment-reconciliation.js`；旧批次数据只读验证。

### Phase 4：商品增强 + 页面收口

- `Product` 新字段、DTO、`AdminCommerceService` 校验（币种/策略/库存/限时）。
- 下单时库存占用/释放、周期次数校验、限时窗口校验。
- C 端商品卡与结算页币种/售罄/待发售展示。
- 后台充值商品标签 + 商品抽屉 + 默认货币。
- `/admin/payments` 四标签完整对齐参考页；旧路由重定向。
- 闸口：`npm run check`。

### Phase 5（可选）：存储商品与聚合渠道

- 存储配额：`StorageGrant`、容量计算、上传校验；再开放 `kind=storage`。
- 易支付/虎皮椒/支付FM 适配器与账单下载。

---

## 12. 测试计划

### 12.1 单元

- 配置加密/解密；密钥字段留空沿用旧值；版本自增；掩码不回显。
- 金额/币种核对；重复回调幂等；订单状态机不可跳跃；`payTransactionId` 去重。
- 关单顺序：查单已支付 → 入账；查单未支付 → 关单；关单失败 → 再查一次。
- 商品上架策略：周期次数、库存占用/释放、限时窗口。
- 对账：`matched / recovered / amount_mismatch / trade_no_mismatch / credit_failed / local_order_not_found / provider_record_missing`。
- 对账补发必须经过签名查单；查单未确认不补发。
- 回调 configId 不匹配、验签失败、金额不符、订单不存在。
- 展示状态派生与 Prisma where 映射、排序白名单、分页越界、导出截断与关键字匹配（§23.9）。

### 12.2 集成

- 本地 mock 渠道服务：支付宝 RSA2 表单、微信 v3 签名与 AES-GCM 回调解密。
- 回调重复、乱序、验签失败、金额不符、订单不存在。
- 收件箱重试：第一次入账失败后 worker 重试成功；重复事件不重复发积分。
- 进程重启后 pending 通知仍能入账。
- 数据库短暂不可用时回调不丢（收件箱落库失败则回渠道失败，渠道重试）。
- 配置版本固定：保存 v2 后，v1 订单的回调仍用 v1 验签与查单。

### 12.3 前端

- `/admin/payments` 四标签渲染、`?tab=` 同步、刷新按钮。
- 渠道配置抽屉：动态字段、密钥占位、保存新版本、无权限隐藏保存。
- 商品新建/编辑、库存不足提示、限时状态；无 USD 渠道时 USD 商品只能存为 `offline`，上架被拒绝。
- 订单筛选/分页/导出/详情/查单/关单。
- 对账执行、运行列表、明细筛选、导出、失败原因。
- 五态：空/loading/有数据/失败/无权限。
- 无 `payment.write` 不显示保存；无 `finance.reconcile` 不显示执行对账（后端仍校验）。

### 12.4 闸口

```bash
cd backend && npm run build
cd frontend && npm run typecheck && npm run build
cd frontend && npx vitest run
node backend/scripts/smoke-payments.js
node backend/scripts/smoke-payment-orders.js        # 新增
node backend/scripts/smoke-payment-reconciliation.js # 新增
npm run check
```

真实渠道（支付宝/微信）的查单、关单、账单下载必须用商户号实跑一次；此前只能声明「代码按官方规格实现，mock 契约已覆盖」。

---

## 13. 风险与取舍

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 凭据从 env 迁到数据库 | 部署方式变化；首次启动无渠道可用 | 启动引导 env → v1 配置；无配置时页面显式告警；生产门禁提示至少配置一个渠道 |
| 加密密钥丢失 | 所有渠道配置不可解密 | 与数据库同备份；轮换需重新录入；日志不打印密钥 |
| SQLite 并发 | 库存占用、收件箱抢任务冲突 | 事务 + 条件更新 + 唯一约束；单机 worker 串行 |
| 支付宝账单 ZIP | 解析失败或引入新依赖 | 引入 `fflate`（MIT，无原生依赖）并通过 `verify:deps:critical`；或先只做微信 CSV + 手工导入 |
| 旧页面/链接下线 | 书签、告警深链 404 | 旧路由重定向；告警与值班带链接同步修改 |
| 订单派生状态 | 与旧订单页文案不一致 | 状态映射集中在 `paymentStatusMeta.ts`；旧订单页补文案 |
| 10 分钟调度器 | 回调入账延迟 | 独立 15s worker；不依赖 `SchedulerService.tick()` |
| 回调 configId | 旧订单回调 404 | 通知 URL 下单时生成；保留一版旧路由（按当前配置）用于在途订单 |
| 存储商品缺配额 | 卖了容量但不限流 | 本轮不做；Phase 5 与配额子系统一起上线 |
| USD 无通道 | 商品卖不出去 | 后端按 `supportedCurrencies` 拒绝上架/支付；前端禁用并说明 |

---

## 14. 验收标准

- [ ] `/admin/payments` 四个标签页与参考页的信息架构、列、抽屉、筛选、分页、导出一致；使用 shadcn，无 antd 新引用。
- [ ] 渠道配置可保存新版本；密钥不回显；历史订单固定版本；回调 configId 与订单一致。
- [ ] 多渠道同时可用；C 端可选择支付方式；缺凭据 503，不降级沙箱；生产过滤沙箱。
- [ ] 查单/关单顺序正确；关单前已支付会入账；失败保持 pending 并可重试。
- [ ] 回调重复不重复发积分；进程重启后 pending 通知仍能入账。
- [ ] 对账可按渠道/日期执行；自动补发前有签名查单确认；差异可筛选/导出；失败原因可见。
- [ ] 商品支持币种、上架策略、库存、限时；下单/取消正确占用与释放库存。
- [ ] 退款仍走订单管理，渠道配置使用订单固定版本；支付页不提供退款按钮。
- [ ] 旧 `/admin/payment-channels`、`/admin/reconciliation` 重定向；告警深链不 404。
- [ ] 所有闸口通过；真实渠道的查单/关单/账单需商户号实跑并留证据。

---

## 15. 评审待确认

1. **USD 商品**：本轮只开 CNY，还是开字段但按渠道能力拒绝 USD？（推荐后者：字段与页面完整，行为不造假）
2. **支付宝 ZIP**：引入 `fflate`，还是 Phase 3 先只支持微信 CSV + 手工导入？（推荐引入 `fflate`，否则「T+1 自动对账」对支付宝不成立）
3. **旧对账数据**：新页面是否需要只读展示旧 `ReconciliationBatch`？（推荐不需要：旧页重定向后，旧数据保留在库，需要时用脚本导出）
4. **支付页是否展示会员订单**：推荐只展示含 `OrderItem` 的商品订单；会员订单留在 `/admin/orders`，避免「商品」列显示会员套餐造成口径混淆。

确认后按 Phase 0 → 4 推进；每批完成后给 `file:line` 摘要与真实闸口结果。

---

## 16. 细化说明：从方案到可开工工单

> 本节起为 **v2.1 可执行细化稿**。§16–§25 只补充实现细节与验收口径，不替换 §0–§15 的业务目标。若与前面章节的字段名、接口形态或任务颗粒度冲突，**以本节为准**，并在 §16.3 明列差异。

### 16.1 事实源与复刻边界

- 页面事实源：`open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`。参考站当前不可达，因此复刻依据是源码中的列、筛选、抽屉、空态、导出与按钮启用条件，不以截图猜测。
- 后端事实源：`open-ai-canvas/backend/internal/app/payment*.go` 与 `backend/payment-plugins/`；协议细节仍以支付宝/微信官方文档为准。
- 本仓库现状事实源：`backend/src/payments/*`、`backend/src/orders/order.service.ts`、`backend/prisma/schema.prisma`、`frontend/src/admin-ui/*`。
- “完整复刻”的范围是四个标签页的**信息架构与可操作项**：列、工具栏、筛选口径、分页、导出、详情/配置/商品抽屉、五态与按钮禁用条件。视觉不照搬 antd，改用本仓库 shadcn 原语；不新增 antd 引用。
- 本轮仍不实现存储扩容商品、聚合支付渠道、支付页内退款。

### 16.2 参考字段到本仓库字段的映射

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

### 16.3 对 §5 / §6 的细化修订

| # | 修订 | 原因 |
| --- | --- | --- |
| A1 | 后台支付控制器放在 `backend/src/admin/payments/`，注册在 `AdminModule`；支付域服务由 `PaymentsModule` 导出 | 权限、审计、DTO 与其它后台控制器同层；支付域不反向依赖 admin 目录 |
| A2 | `POST /orders/:orderId/cancel` 的 URL 不变，但实现从 `OrdersController` 移到 `PaymentsModule` 的独立控制器 | 取消必须先查渠道；若让 `OrdersModule` 反向依赖 `PaymentsModule` 会形成循环依赖 |
| A3 | `PaymentReconciliationRun` 增加 `attempt Int @default(1)`，唯一键改为 `(providerId, billDate, attempt)` | 失败账单必须可重跑；只保留 `(providerId, billDate)` 会让一次网络失败永久锁死该日期 |
| A4 | 支付宝 ZIP 不引入 `fflate`；从现有 `backend/src/model/protocol/package.ts` 抽出通用只读 ZIP 解析器 | 已有 stored/deflate + 中央目录解析与测试；重复引依赖只会多一棵供应链 |
| A5 | 页面“入账时间”映射 `Order.paidAt`，不新增 `creditedAt` | 现有 `markPaid()` 已在同一事务里写 `paidAt`；新增字段会让两个时间源打架 |
| A6 | 后台列表响应统一为 `{ items, total, page, pageSize }`，不采用参考实现的 `{ orders }` / `{ runs }` | 与 `useAdminList()`、`AdminDataTable` 和本仓库其它后台列表一致 |
| A7 | 支付订单默认只查 `items.some({})` 的商品单；会员单留给 `/admin/orders` | 会员单的“商品/权益”口径不同，混排会让支付页的权益列失真 |
| A8 | `PaymentNotification.providerEventId` 缺失时使用 `sha256(providerId + ':' + rawBody)` 作为事件键 | 部分渠道不提供稳定事件 id；用原始报文摘要才能保证重复通知去重 |
| A9 | 旧 `/admin/payment-channels`、`/admin/reconciliation/batches*` 只保留一版兼容读；旧写入口返回 `41001` | 前端深链与值班脚本需要迁移窗口；继续写旧表会产生两套对账真相 |

---

## 17. 后端文件清单与职责

### 17.1 新增/调整的文件树

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
        ├── payment-products.controller.ts
        ├── payment-orders.controller.ts
        ├── payment-reconciliation.controller.ts
        └── dto/
            ├── payment-provider.dto.ts
            ├── payment-product.dto.ts
            ├── payment-order.dto.ts
            └── payment-reconciliation.dto.ts
```

### 17.2 支付域文件职责

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

### 17.3 旧文件处置

| 现有文件 | 处置 |
| --- | --- |
| `payments/payment.factory.ts` | 删除；调用点改为 `PaymentAdapterRegistry` / `PaymentConfigService`。当前调用点只有 `payments.service.ts`、`admin/payment-channels.controller.ts`、`orders/order.service.ts` |
| `payments/alipay.provider.ts`、`wechat.provider.ts`、`sandbox.provider.ts` | 协议代码迁入对应 adapter；类名与构造参数改为显式接收 `PaymentContext`，不再在字段初始化时读 env |
| `payments/payment-provider.interface.ts` | 保留 `normalizePem()`、`centsToYuan()`、`yuanToCents()` 三个纯函数；旧的 env 型 `PaymentProvider` 契约删除 |
| `admin/payment-channels.controller.ts` | Phase 1 保留为兼容只读端点，内部改调 `PaymentConfigService`；Phase 4 删除 |
| `admin/reconciliation.controller.ts`、`reconciliation.service.ts` | Phase 3 起只读；旧导入/处置写入口返回 `41001`；Phase 4 删除旧页面后下线 |

### 17.4 后台文件职责

| 文件 | 路由 | 权限 | 职责 |
| --- | --- | --- | --- |
| `payment-providers.controller.ts` | `GET /admin/payments/providers`、`PUT /admin/payments/providers/:id/config` | `payment.read` / `payment.write` | 渠道列表、动态字段、保存新版本；写审计 `payment.provider_config_save` |
| `payment-settings.controller.ts` | `GET/PUT /admin/payments/settings` | `payment.read` / `payment.write` | 默认充值币种，写入现有 settings 服务 |
| `payment-products.controller.ts` | `GET/POST /admin/payments/products`、`PUT /admin/payments/products/:id` | `product.read` / `product.write` | 复用 `AdminCommerceService`，增加支付商品字段与上架校验 |
| `payment-orders.controller.ts` | `GET /admin/payments/orders`、`GET /admin/payments/orders/export.csv`、`GET /admin/payments/orders/:id`、`POST .../:id/query`、`POST .../:id/close` | `payment.read` / `payment.read + data.export` / `payment.operate` | 列表、详情、导出、查单、关单；导出审计 `data.export` |
| `payment-reconciliation.controller.ts` | `POST/GET /admin/payments/reconciliations`、`GET .../:id/items`、两个 CSV、`POST .../import` | `finance.reconcile` / `payment.read` / `payment.read + data.export` | 执行、列表、明细、导出、CSV 兜底导入 |

### 17.5 模块接线

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

### 17.6 首次启动引导

`PaymentConfigService implements OnModuleInit`，只在**数据库没有任何 `PaymentProviderConfig`** 时执行一次：

1. 读取 `PAYMENT_PROVIDER`，非法值按 `sandbox` 处理并告警。
2. 按下表从现有 env 组装 v1 `values`；只创建该渠道，不为其它渠道造空配置。
3. `enabled = (providerId === PAYMENT_PROVIDER)`；真实渠道缺必填字段时仍创建版本但 `enabled=false`，启动日志 `error` 提示缺项，不自动降级沙箱。
4. `createdBy = 'bootstrap'`，`version=1`，`configDigest` 按完整配置计算。
5. 之后所有读写只看数据库；除 `PAYMENT_NOTIFY_BASE` 外不再从 env 读凭据。

| 适配器 | env → 配置字段 |
| --- | --- |
| `alipay` | `ALIPAY_APP_ID→appId`、`ALIPAY_PRIVATE_KEY→merchantPrivateKey`、`ALIPAY_PUBLIC_KEY→alipayPublicKey`、`ALIPAY_GATEWAY→gateway` |
| `wechat` | `WECHAT_APP_ID→appId`、`WECHAT_MCH_ID→mchId`、`WECHAT_SERIAL_NO→merchantSerialNo`、`WECHAT_PRIVATE_KEY→merchantPrivateKey`、`WECHAT_API_V3_KEY→apiV3Key`、`WECHAT_PLATFORM_PUBLIC_KEY→wechatPayPublicKey` |
| `sandbox` | 无 |

引导完成后再改 env 不生效；部署文档必须明确“改渠道请到后台保存新版本”。`PAYMENT_NOTIFY_BASE` 仍是部署配置，不进入后台可编辑字段，避免把回调地址改到不可达域名。

---

## 18. 后端类型、服务签名与 DTO

### 18.1 适配器契约

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

### 18.2 首批配置字段

| 适配器 | 字段 |
| --- | --- |
| `sandbox` | 无必填 |
| `alipay` | `appId`（必填、identity）、`sellerId`（可选、identity）、`merchantPrivateKey`（secret、PEM）、`alipayPublicKey`（secret、PEM）、`gateway`（url，默认官方网关，白名单校验） |
| `wechat` | `appId`（必填、identity）、`mchId`（必填、identity）、`merchantSerialNo`（必填）、`merchantPrivateKey`（secret、PEM）、`apiV3Key`（secret、32 字节）、`wechatPayPublicKey`（secret、PEM）、`apiBase`（url，默认 `https://api.mch.weixin.qq.com`，仅允许官方域名） |

`validateConfig()` 返回缺失/非法字段名，不返回值。保存时再校验：

- `closeAfterMinutes` 为 5–1440 的整数。
- 整个 `values` 序列化后 ≤ 32KB；单字段 ≤ 16KB。
- `apiV3Key` 解码后必须 32 字节；三份 PEM 必须能被 `createPrivateKey/createPublicKey` 解析。
- `gateway/apiBase` 只允许官方生产/沙箱域名；禁止 IP、localhost、非 HTTPS（测试环境显式放行 localhost 时需单独开关）。
- `enabled=true` 时必须 `validateConfig().length === 0`。

### 18.3 `PaymentConfigService` 签名

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

### 18.4 支付编排服务签名

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

### 18.5 后台 DTO 与校验

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

### 18.6 响应形态

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

### 18.7 错误码

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

## 19. Prisma 最终模型、索引与升级

> 本节是**最终模型**。§5 是初版草案；凡本节与 §5 不一致处，以本节为准。差异集中在对账运行表的 `attempt`、通知收件箱的 `processing` 中间态，以及库存字段的语义。仍不引入 Prisma enum，所有状态继续用 `String` + service 白名单，原因见 §5 开头。

### 19.1 `PaymentProviderConfig`（新增）

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

### 19.2 `Order` 扩展（最终字段）

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

- `Order.status` 仍是 `pending | paid | cancelled | refunded | partial_refunded`。页面的 `created / closing / create_failed / credited` 是**派生展示状态**，不写库（见 §22）。
- `providerTradeNo` 单独冗余在 Order 上，是为了支付页搜索和列表不必 join 最近一条 Payment；唯一约束也提供第二道重复交易号防线。
- 旧订单 `providerConfigId=null`：查单/回调使用同渠道**当前最新版**配置，并在第一次成功解析后回填 `providerConfigId/version`；不得为了回填而改变 `channel`。
- `checkoutValue` 在本地关闭、渠道关闭、支付成功、退款完成时置空；空串表示「没有可用支付动作」，`null` 只用于从未生成过 checkout 的历史数据。

### 19.3 `Payment` 扩展（最终字段）

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

### 19.4 `PaymentNotification`（新增，最终字段）

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

### 19.5 对账表（新增，修订 §5.5）

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
- 旧 `ReconciliationBatch/Item` 不再写；保留只读一版用于历史查看，旧写接口返回 `41001`（§20.7）。

### 19.6 `Product` 扩展（最终字段）

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

### 19.7 站点设置新增键

`backend/src/common/setting-defs.ts`：

```ts
{ key: 'payment.defaultCurrency', group: 'payment', type: 'select', options: ['CNY','USD'], default: 'CNY', public: true }
```

同时在 `SETTING_GROUP_LABELS` 增加 `payment: '支付'`。该键只决定**新建商品默认币种**与 C 端充值面板默认 tab，不改写历史商品价格。

### 19.8 升级顺序与旧数据兼容

本仓库以 `prisma db push` 管理 SQLite，不生成 migration 文件。上线按以下顺序，任一步失败都停在原地，不继续：

```bash
# 1. 备份（生产必须先做；开发库也建议）
cp backend/dev.db "backend/backups/dev-$(date +%Y%m%d-%H%M%S).db"

# 2. 停后端，避免旧进程继续写旧字段
# 3. 校验 schema 可解析并生成 client
cd backend && npx prisma validate && npm run prisma:generate

# 4. 推送结构（只新增表/可空列/带默认值列，不应提示删列）
npm run db:push:dev

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

### 19.9 种子与权限矩阵

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

`payment.write` 加入 `HIGH_RISK_PERMISSIONS`，保存渠道配置仍自动写 `AdminAuditLog`，不要求填写 `reason`；同权限下的站点设置接口同样自动写审计。`payment.operate` 不是高危：它只推进渠道已经发生的事实，不能凭空造钱；但每次仍写普通审计。

`seed:roles` 会用代码中的 `ROLE_PERMISSIONS` 覆盖内置角色权限（见 `backend/scripts/seed-roles.ts`）。生产若已在角色页手工调过权限，先导出/核对再执行，避免覆盖自定义授权。

## 20. 后端接口最终契约与实现顺序

### 20.1 通用约定

- 前缀：全局 `app.prefix = api/v1`，下文省略 `/api/v1`。
- 成功响应沿用 `ResponseInterceptor` 信封：`{ code: 0, data, message }`。本文只写 `data`。
- 错误沿用 `AppError(code, message, status)`；`code` 见 §18.7。
- 所有后台接口必须 `@UseGuards(JwtAuthGuard, AdminGuard)` 并显式 `@RequirePermission(...)`；不能只靠导航隐藏。
- 所有分页列表返回 `{ items, total, page, pageSize }`。固定规模列表（渠道）也返回该结构，`page=1`、`pageSize=items.length`，保证前端 `useAdminList` 可复用。
- 日期筛选参数一律 `YYYY-MM-DD`，按 `Asia/Shanghai` 取自然日并转成 UTC 边界：`from=2026-10-01` → `2026-09-30T16:00:00.000Z`，`to=2026-10-01` → `2026-10-02T15:59:59.999Z`。
- 金额字段一律整数最小单位；接口字段名统一 `amountCents / priceCents / originalPriceCents`，不出现 `amountFen`。
- 敏感值只进密文列；任何响应都不能包含 `configCipher / payloadCipher / rawPayload`。

### 20.2 C 端支付

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
| POST | `/payments/callback/:providerId/:configId` | 新订单固定配置版本；必须与订单 `providerConfigId` 一致 |
| POST | `/payments/callback/:providerId` | 迁移窗口兼容；按该渠道最新配置验签，处理成功日志 `warn` |

通知 URL 由 `createOrder()` 传入：`${PAYMENT_NOTIFY_BASE}/api/v1/payments/callback/${providerId}/${configId}`。`configId` 是随机 cuid，不含密钥；公开可见但无法枚举出有用信息。

`PaymentNotificationService.ingest()` 的响应必须由适配器的 `ack()` 生成：支付宝纯文本 `success/fail`，微信 JSON `{code,message}`，不能套统一信封。

### 20.3 后台渠道与设置

#### `GET /admin/payments/providers`

权限 `payment.read`。响应 `PageResult<AdminPaymentProviderView>`。在 §18.6 基础上补两个字段：

```ts
interface AdminPaymentProviderView {
  // ...§18.6 已有字段
  /** 已有订单绑定过该渠道的 identity 字段时，后台不允许修改 */
  identityLockedFields: string[];
  /** 当前是否有未完成订单引用旧版本，用于文案提示 */
  hasOpenOrders: boolean;
}
```

`values` 只含非 secret 字段；secret 字段只返回 `secretConfigured[name]=true`。`missing` 是当前版本缺失的必填项；`warnings` 用于「渠道已启用但缺密钥」「网关非官方域名」「生产仍启用沙箱」。

#### `PUT /admin/payments/providers/:providerId/config`

权限 `payment.write`，高危操作，写审计但不要求填写原因。请求体见 §18.5。响应：

```json
{ "provider": { "id": "alipay", "version": 4, "configured": true }, "unchanged": false }
```

空字符串的 secret 字段表示「沿用上一版」；要清空 secret 不允许，必须禁用渠道并保存新版本。身份字段（`identity=true`）一旦有历史订单绑定，修改返回 `40001`。

#### `GET/PUT /admin/payments/settings`

权限分别 `payment.read / payment.write`。GET 返回 `{ "defaultCurrency": "CNY" }`；PUT 请求 `{ defaultCurrency }`，写现有 settings 服务并自动写审计。

#### `GET /admin/payments/products`

权限 `product.read`。响应 `PageResult<AdminPaymentProductView>`。默认按 `sortOrder asc, createdAt desc`，一次最多返回 500 条；页面不显示分页（与参考页一致），超过 500 条说明商品配置方式需要治理。

#### `POST /admin/payments/products`、`PUT /admin/payments/products/:id`

权限 `product.write`。请求体见 §18.5。响应 `{ product }`。服务端通过 `AdminCommerceService.savePaymentProduct()` 写 `Product`，不能另建一套商品表。

保存时校验：

- SKU：新建省略时生成 `PAY-YYYYMMDD-XXXX`；编辑不可改。
- `kind=storage` 永远 `40001`（D7）。
- `currency=USD` 且 `status=active`：必须至少有一个启用且支持 USD 的渠道，否则 `40001`。
- 库存：`stockTotal >= stockSold + stockReserved`；下架不清空库存。
- 周期：两个字段都 > 0；切换策略时把不相关字段归零。
- 限时：`saleStartAt < saleEndAt`，按上海时区解释；允许开始时间已过，但结束时间必须晚于当前。
- `priceCents` 最低 1；`credits` 最低 1；`creditsValidDays=0` 表示永久。

### 20.4 后台支付订单

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

权限 `payment.operate`。空请求体；调用 `PaymentOrderService.query({ actor: { kind:'admin', adminId } })`，自动写审计动作 `payment.order_query`。返回：

```json
{ "order": { "id": "ord_x", "status": "credited" }, "view": { "orderId": "ord_x", "displayStatus": "credited" } }
```

渠道失败返回 `50302`，不返回 200 + 旧状态伪装成功。

#### `POST /admin/payments/orders/:id/close`

权限 `payment.operate`。空请求体；自动写审计动作 `payment.order_close`。顺序与 C 端取消一致；已支付时先入账再返回 `40901`，由前端刷新列表。已关闭返回幂等 200。

#### `GET /admin/payments/orders/export.csv`

权限 `payment.read + data.export`。筛选参数与列表完全一致，忽略 `page/pageSize`，上限 10000 行。`Content-Disposition` 文件名：`支付订单-YYYYMMDD-HHmmss.csv`。导出动作写审计 `data.export`，参数里不得含密钥。

### 20.5 后台对账

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

权限 `finance.reconcile`。`multipart/form-data`：`file + providerId + billDate`。只接受 `.csv` 或支付宝 `.zip`；≤ 20MB。解析出的记录走同一套比对逻辑，run.source 记为 `csv`。CSV 表头必须能被现有 `reconciliation.service.ts` 的解析器识别；支付宝 ZIP 复用 §17.1 的 `zip-reader.ts`。

#### 对账导出

| 路径 | 权限 | 内容 |
| --- | --- | --- |
| `GET /reconciliations/export.csv` | `payment.read + data.export` | 运行汇总，筛选项同列表 |
| `GET /reconciliations/:id/items/export.csv` | `payment.read + data.export` | 单次运行明细，`result` 可选 |

明细导出只允许 `status='completed'` 的 run；执行中返回 `40901`。

### 20.6 CSV 列（最终）

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

### 20.7 旧入口兼容与下线

| 旧入口 | Phase 1–3 | Phase 4 |
| --- | --- | --- |
| `GET /admin/payments`、`/admin/payments/export`（支付流水） | 保留只读，前端改名为 `adminPaymentLedgerApi` | 保留；它是既有流水查询，不与新订单列表混用 |
| `GET /admin/payment-channels` | 只读兼容，内部转 `PaymentConfigService.listAdmin()` | 删除；页面路由已重定向 |
| `GET /admin/reconciliation/batches*` | 只读兼容，读旧表 | 删除；历史数据仍留库 |
| `POST /admin/reconciliation/import` | 迁移窗口可继续写旧表，响应头 `Deprecation: true` | `41001` |
| `POST /admin/reconciliation/items/:id/resolve` | 迁移窗口可继续写旧表 | `41001` |

`41001` 响应体沿用统一错误信封，message 固定「旧对账写入口已下线，请使用 /admin/payments/reconciliations」，并带 `data: { replacement: '/admin/payments?tab=reconciliation' }`。前端旧页面在 Phase 4 删除。

### 20.8 服务签名、事务边界与状态落库

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
7. 计算 `grantedCredits` 并发放积分（沿用现有逻辑，manual 商品跳过自动发放）。
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

计数在全部记录处理完后一次性回写；每个 item 的 create 与最终计数更新各自短事务，避免 1000 条账单长时间持锁。`(runId, merchantOrderNo)` 唯一，重复解析不会重复补发。自动补发只走签名查单，不直接相信上传 CSV 的「成功」字样。

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

取消/超时释放库存：`releaseReservation(orderId)` 幂等，按 items 的 quantity 回加 `stockReserved--`，并把 `Order.stockReserved` 置 false。支付成功时在 `markPaid` 事务内把占用转成已售。该 helper 放在 `OrdersModule`，支付层只调用 `OrderService`，不直接写库存。

## 21. 前端文件树与组件拆分

### 21.1 新增文件

```text
frontend/src/pages/admin/payments/
├── AdminPaymentsPage.tsx             # 页面壳：标题、通知条、四标签、URL 同步、刷新
├── PaymentsProvidersTab.tsx          # 支付渠道列表
├── PaymentsProductsTab.tsx           # 充值商品列表 + 默认币种
├── PaymentsOrdersTab.tsx             # 支付订单列表、筛选、导出
├── PaymentsReconciliationTab.tsx     # 对账执行、运行列表
├── ProviderConfigDrawer.tsx          # 动态渠道配置
├── ProductFormDrawer.tsx             # 新建/编辑商品
├── PaymentOrderDetailDrawer.tsx      # 订单详情
├── ReconciliationDetailDrawer.tsx    # 对账明细抽屉
├── PaymentBrandIcon.tsx              # 内联品牌图标，无外链
├── paymentStatusMeta.ts              # 订单状态文案/色调/可执行动作
└── paymentProductMeta.ts             # 商品 saleStatus、金额、权益格式化
```

测试文件就近放置：

```text
frontend/src/pages/admin/payments/AdminPaymentsPage.test.tsx
frontend/src/pages/admin/payments/paymentStatusMeta.test.ts
frontend/src/pages/admin/payments/paymentProductMeta.test.ts
frontend/tests/admin-payments.spec.ts
```

约束：

- 只引用 `frontend/src/admin-ui/*`、`lucide-react`；不新增 antd 引用。
- 不新增状态管理库；列表状态用现有 `useAdminList` / `useAdminResource`，页签状态直接用 URL。
- 金额格式化统一 `${currency === 'USD' ? '$' : '¥'}${(cents / 100).toFixed(2)}`；积分整数用千分位。

### 21.2 页面壳 `AdminPaymentsPage.tsx`

结构：

```text
PageHeader（支付充值 / 描述 / 刷新按钮）
Notice（本页不提供退款；退款请到订单管理。页面只提供查单、关单、对账）
TabGroup
  ├─ providers      支付渠道
  ├─ products       充值商品
  ├─ orders         支付订单
  └─ reconciliation 支付对账
```

URL 同步：

- 唯一事实源是 `useSearchParams()` 的 `tab`，合法值 `providers | products | orders | reconciliation`；非法/缺失一律视为 `providers`，不发请求前不写 URL。
- `onChange` 用 `setSearchParams(prev => { next.set('tab', value); return next }, { replace: true })`，保留 `status/keyword/...` 等订单深链。
- 浏览器前进/后退改变 `tab` 时，`TabGroup` 随 URL 重渲染，不额外维护本地 `activeTab`。
- 订单深链 `/admin/payments?tab=orders&status=created&from=...` 必须在首次请求前被 `PaymentsOrdersTab` 读入，避免先发一次空筛选请求。

通知条沿用参考页的位置与样式，但文案必须改写：参考页说「平台不提供支付退款」，本仓库的退款在 `/admin/orders` 内完整存在，照抄会误导运营。标题用「退款请到订单管理」，正文说明「关单前始终先向渠道查单；对账发现已支付未入账订单时会幂等补发积分」。

刷新：

- 页面持有 `refreshNonce`，点击刷新仅自增；当前标签把这些值放进 `useAdminResource` 依赖，或 `useAdminList` 的 effect 中调用 `reload()`。
- 不在刷新时重置筛选与分页。
- 页面本身不拉数据；每个标签独立拥有 loading/error/data，切换标签不会清空已加载的另一标签（React 保持挂载），但首次进入才请求。

### 21.3 `PaymentsProvidersTab.tsx`

数据：`adminPaymentProvidersApi.list()`；固定规模，无分页、无搜索。

列（与参考页一致）：

| 列 | 内容 |
| --- | --- |
| 支付渠道 | `PaymentBrandIcon` + 名称 + `id` 等宽小字 |
| 支付方式 | `redirect` → 网站跳转；`qrcode` → 扫码支付；`sandbox` → 站内模拟 |
| 状态 | `enabled && configured` → 可用；否则不可用；副行「配置已启用/停用 · 密钥已配齐/缺 N 项」（`missing.length`）；不再显示参考页的 plugin 状态 |
| 未支付自动关闭 | `closeAfterMinutes` 分钟 |
| 配置版本 | `v{version}` / 未配置 |
| 操作 | 「配置」按钮；无 `payment.write` 时只显示「查看」或不显示 |

空态：`没有发现支付渠道`；不把空列表误报成网络失败。

`ProviderConfigDrawer`：

- 宽度 620；标题 `配置 {name}`；底部主按钮「保存新版本」。
- 顶部 Notice：密钥加密保存、历史订单固定版本；`enabled` 但缺字段时给 danger 提示。
- 字段：启用开关、自动关闭分钟数（`NumberInput` 5–1440）、动态 `configFields`。
- `field.secret`：输入框 `type=password`，placeholder `已配置，留空沿用`；不把密文回显到 DOM。
- `field.identity` 且在 `identityLockedFields` 中：禁用输入并说明「已有订单绑定，不能修改」。
- 表单值只提交当前填写的字段；secret 空串交给后端沿用旧值。
- 保存成功后关闭并刷新列表；不要求填写变更原因。
- 前端校验只做必填/长度；配置字段语义仍以后端 `validateConfig()` 为准。

### 21.4 `PaymentsProductsTab.tsx`

工具栏：

- 左：「默认充值货币」`SelectBox`（CNY/USD），变更前弹出 `ConfirmAction` 说明影响；保存后刷新 C 端设置。
- 右：「新增商品」按钮；无 `product.write` 时隐藏。

列：

| 列 | 内容 |
| --- | --- |
| 商品 | 名称 + 描述（空显示「无说明」） |
| 售价 | 按币种格式化；有划线价时同时展示 |
| 权益 | `{credits} 积分` + 有效期（0=永久） |
| 排序 | 数值 |
| 上架策略 | 不限量 / 周期 X 天·Y 次 / 库存剩余/总量 / 限时（待发售/已结束） |
| 状态 | 销售中 / 待发售 / 已结束 / 已售罄 / 已停用 |
| 操作 | 编辑 |

`ProductFormDrawer`：

- 宽度 520；新建标题「新增商品」，编辑「编辑商品」。
- 字段顺序：名称、说明、商品类型、售价币种、售价、到账积分、积分有效期、发放方式、上架策略、策略字段、排序、上架开关。
- 商品类型：`credits` 可选；`storage` 选项保留但 `disabled`，说明「存储扩容商品将在配额子系统上线后开放」。
- 币种：`USD` 在无可用 USD 渠道时仍可选择 `offline` 保存，但选择 `active` 时禁用保存并提示；CNY 始终可选。
- 价格输入用「元/美元」小数，提交前 `Math.round(value * 100)`；禁止 0。
- 积分只接受正整数；有效期 0–3650。
- 限时字段用原生 `datetime-local`，提交转 ISO；前端按浏览器本地时区显示，后端按 `Asia/Shanghai` 校验。为避免歧义，抽屉下方注明「时间按北京时间解释」。
- 切换策略时立即清空不相关字段，提交时也由后端归零。
- `saleStatus` 不在编辑表单中修改，只展示派生结果。

### 21.5 `PaymentsOrdersTab.tsx`

数据：`useAdminList<PageResult<AdminPaymentOrderRow>>`，fetcher 调 `adminPaymentOrdersApi.list(params)`；初始参数从 URL 读取并校验白名单。

筛选是「草稿 → 应用」两段式，与参考页一致：

- 草稿：`keyword / status / providerId / timeField / from / to`。
- 点击「查询」才 `setQuery(applied, true)`；`useAdminUrlFilterSync(applied)` 回写 URL。
- 草稿与应用值不同时显示「请先查询以应用筛选条件」，并禁用导出。
- 分页/排序立即 `setPage`，不需要再次点查询；修改分页不改变筛选草稿。

工具栏：

- 搜索框 placeholder「搜索名称、用户名、邮箱、订单号」，`title` 说明「支持名称、用户名、邮箱、订单号、渠道交易号和完整用户 ID」，支持回车查询。
- 状态、渠道、时间口径、开始日期、结束日期（原生 `input type=date`）。
- 查询按钮、重置按钮（清空并立即查询）、导出 CSV。
- 导出仅在已应用、非 loading、`total>0` 且同时具备 `payment.read + data.export` 时可用。

列：

| 列 | 内容 |
| --- | --- |
| 用户 | 姓名/邮箱，可点击进入 `/admin/users?id=${userId}`；`AdminUsersPage` 用 `useAdminDetailParam()` 读 `id` 并打开详情抽屉。用户不存在显示「用户不存在」+ 截断 id |
| 订单 / 商品 | 订单号（等宽、可复制、超长截断）+ 商品名 |
| 渠道 | 品牌图标 + 名称 |
| 金额 / 权益 | 金额 + `{credits} 积分` |
| 状态 | `paymentStatusMeta` 的状态色标签 |
| 创建时间 | `MM-DD HH:mm`，`title` 显示完整秒 |
| 操作 | 详情；未终态显示「同步状态」；`created/pending/create_failed/closing` 显示「关闭」 |

分页：服务端，默认 30，可选 30/50/100（与参考页的 30 条/页对齐；其它后台页仍默认 20，不强行统一）；`AdminDataTable` 的 `pagination.current/pageSize/total/onChange`。

`PaymentOrderDetailDrawer`：

- 宽度 680；标题「支付订单详情」。
- `Descriptions`：用户、邮箱、用户 ID、订单号、渠道交易号、商品、支付渠道、金额/权益、状态、配置版本、创建/过期/支付/入账/关闭时间、失败原因。
- 渠道交易号/订单号提供复制按钮（`navigator.clipboard`，失败 toast，不阻塞）。
- `payments` 历史只读列表：每次意图的状态、金额、交易号、创建/支付时间；不展示 rawPayload。
- 抽屉不提供退款按钮；退款仍跳 `/admin/orders?orderNo=...`。
- 详情参数用 `?orderId=`。把现有 `useAdminDetailParam()` 扩成 `useAdminDetailParam(param = 'id')`，订单页传 `orderId`；默认值不变，`AdminUsersPage` 等旧调用方无需改动。关闭时删除该参数，支持刷新复原。不要另造一套 URL 协议，也不要复用含义不同的 `id`。

「同步状态」「关闭」均使用 `ConfirmAction` 收集原因并显示影响；成功后 `reload()`，失败 toast 原文。关闭已支付订单返回 409 时提示「已入账，请刷新」并刷新。

### 21.6 `PaymentsReconciliationTab.tsx`

执行区（表格上方独立 Panel）：

- 渠道选择：只列 `configured && supportsReconciliation` 的渠道；sandbox 默认不参与。
- 账单日期：原生 date，默认昨天，最晚昨天、最早 90 天前。
- 「执行对账」按钮：需要 `finance.reconcile` 与已选渠道；点击前 `ConfirmAction` 填原因。
- 提示文案：`系统每天 10:15 后自动对账昨日账单；失败可在同一日期重跑。`

运行列表：

- 筛选：渠道、状态（running/completed/failed）、开始/结束日期；两段式草稿 → 应用与订单页相同，但按钮文案按参考页用「筛选」而不是「查询」，重置按钮保留。
- 列：账单日期、渠道、状态、一致、自动补发、异常、完成时间、明细。
- 状态色：completed 成功、running 信息、failed 错误；异常数 >0 用错误色。
- 分页服务端，默认 30，可选 30/50/100。
- 「查看」打开 `ReconciliationDetailDrawer`，`?runId=` 同步；同样扩展现有 `useAdminDetailParam('runId')`，不要复用订单的 `orderId`。

`ReconciliationDetailDrawer`：

- 宽度 1080（窄屏满宽）；标题 `{渠道} · {账单日期} 对账明细`；失败 run 顶部展示 `run.error`。
- 结果筛选：全部 / 仅异常 / 七种具体结果；用 `useAdminResource` 依赖 `runId + page + result` 拉取，不能条件调用 hook。
- 列：结果、商户订单号、渠道交易号、金额、说明。
- 底部翻页，默认 50，可选 50/100/200；右上「刷新」「导出明细 CSV」；只有 completed 且 total>0 可导出。
- 空态区分 failed（未生成明细）和无交易（账单为空）。

### 21.7 `paymentStatusMeta.ts`

```ts
export type PaymentDisplayStatus =
  | 'created'
  | 'pending'
  | 'closing'
  | 'create_failed'
  | 'closed'
  | 'credited'
  | 'refunded'
  | 'partial_refunded';

export const PAYMENT_STATUS_META: Record<
  PaymentDisplayStatus,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'brand'; canQuery: boolean; canClose: boolean }
> = { /* 见 §22.1 */ };

export function paymentStatusOf(input: {
  rawStatus: string;
  providerConfigId: string | null;
  checkoutMode: string | null;
  lastError: string | null;
  closeStartedAt: string | null;
  refundedCents: number;
}): PaymentDisplayStatus;
```

后端与前端必须用同一优先级；前端函数只用于测试/本地兜底，列表主状态仍以后端 `status` 为准，避免两边时钟不同导致翻页时状态跳变。

### 21.8 `paymentProductMeta.ts`

```ts
export type ProductSaleStatus = 'disabled' | 'on_sale' | 'upcoming' | 'ended' | 'sold_out';

export function productSaleStatusOf(product: {
  status: string;
  saleStrategy: string;
  saleStartAt: string | null;
  saleEndAt: string | null;
  stockRemaining: number;
}, now?: Date): ProductSaleStatus;

export function strategyText(product: AdminPaymentProductView): string;
export function creditsText(product: AdminPaymentProductView): string;
export function moneyText(cents: number, currency: string): string;
```

规则：

- `status !== 'active'` → `disabled`。
- `timed` 且 now < start → `upcoming`；now > end → `ended`。
- `inventory` 且 `stockRemaining <= 0` → `sold_out`。
- 其余 → `on_sale`。
- 时间解析只用 ISO 字符串；不依赖浏览器时区做窗口判断，后端返回的 `saleStatus` 与本地计算结果不一致时以服务端为准（列表可能出现分钟级边界差）。

### 21.9 API 分组与类型

`frontend/src/lib/api.ts` 新增四组，避免与旧 `adminPaymentsApi` 重名：

```ts
export const adminPaymentProvidersApi = {
  list: () => request<PageResult<AdminPaymentProviderView>>('/admin/payments/providers'),
  saveConfig: (providerId: string, body: PaymentProviderConfigUpdate) =>
    request<{ provider: AdminPaymentProviderView; unchanged: boolean }>(
      `/admin/payments/providers/${providerId}/config`,
      { method: 'PUT', body },
    ),
  settings: () => request<{ defaultCurrency: PaymentCurrency }>('/admin/payments/settings'),
  saveSettings: (body: { defaultCurrency: PaymentCurrency }) =>
    request<{ defaultCurrency: PaymentCurrency }>('/admin/payments/settings', {
      method: 'PUT',
      body,
    }),
};

export const adminPaymentProductsApi = {
  list: () => request<PageResult<AdminPaymentProductView>>('/admin/payments/products'),
  create: (body: PaymentProductInput) =>
    request<{ product: AdminPaymentProductView }>('/admin/payments/products', { method: 'POST', body }),
  update: (id: string, body: PaymentProductInput) =>
    request<{ product: AdminPaymentProductView }>(`/admin/payments/products/${id}`, {
      method: 'PUT',
      body,
    }),
};

export const adminPaymentOrdersApi = {
  list: (params: PaymentOrderListParams) =>
    request<PageResult<AdminPaymentOrderRow>>(`/admin/payments/orders${toQuery(params)}`),
  detail: (id: string) => request<{ order: AdminPaymentOrderDetail }>(`/admin/payments/orders/${id}`),
  query: (id: string) =>
    request<{ order: AdminPaymentOrderRow; view: unknown }>(
      `/admin/payments/orders/${id}/query`,
      { method: 'POST', body: {} },
    ),
  close: (id: string) =>
    request<{ order: AdminPaymentOrderRow; view: unknown }>(
      `/admin/payments/orders/${id}/close`,
      { method: 'POST', body: {} },
    ),
  exportCsv: (params: PaymentOrderListParams) =>
    downloadCsv(`/admin/payments/orders/export.csv${toQuery(params)}`),
};

export const adminPaymentReconciliationApi = {
  run: (body: { providerId: string; billDate: string; retryFailed?: boolean }) =>
    request<{ run: AdminReconciliationRun; reused: boolean }>('/admin/payments/reconciliations', {
      method: 'POST',
      body,
    }),
  list: (params: ReconciliationListParams) =>
    request<PageResult<AdminReconciliationRun>>(
      `/admin/payments/reconciliations${toQuery(params)}`,
    ),
  items: (id: string, params: { result?: string; page?: number; pageSize?: number }) =>
    request<{
      run: AdminReconciliationRun;
      items: AdminReconciliationItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/admin/payments/reconciliations/${id}/items${toQuery(params)}`),
  importFile: (file: File, providerId: string, billDate: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('providerId', providerId);
    fd.append('billDate', billDate);
    return request<{ run: AdminReconciliationRun }>('/admin/payments/reconciliations/import', {
      method: 'POST',
      body: fd,
    });
  },
  exportRunsCsv: (params: ReconciliationListParams) =>
    downloadCsv(`/admin/payments/reconciliations/export.csv${toQuery(params)}`),
  exportItemsCsv: (id: string, result?: string) =>
    downloadCsv(`/admin/payments/reconciliations/${id}/items/export.csv${toQuery({ result })}`),
};
```

命名迁移：

- 旧 `adminPaymentsApi`（支付流水只读）→ 重命名 `adminPaymentLedgerApi`；当前只有定义，无页面调用，改名无迁移面。
- 旧 `adminReconciliationApi`（旧批次表）→ Phase 2 先保留给值班告警；Phase 4 改为只读兼容或由 `adminPaymentReconciliationApi.list({ status:'failed' })` 替换 `DutyContext.tsx` 中的 `batches` 调用。
- 旧 `adminPaymentChannelsApi` 在 Phase 4 删除；`AdminPaymentChannelsPage.tsx` 同步删除。

`frontend/src/types/api.d.ts` 新增：

```ts
export type PaymentProviderId = 'sandbox' | 'alipay' | 'wechat';
export type PaymentCurrency = 'CNY' | 'USD';
export type PaymentCurrencyLike = PaymentCurrency | string;

export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number }
export interface AdminPaymentProviderView { /* §18.6 + identityLockedFields/hasOpenOrders */ }
export interface AdminPaymentProductView { /* §18.6 */ }
export interface AdminPaymentOrderRow { /* §18.6 */ }
export interface AdminPaymentOrderDetail extends AdminPaymentOrderRow { /* §20.4 */ }
export interface AdminReconciliationRun { /* §19.5 */ }
export interface AdminReconciliationItem { /* §19.5 */ }
export type PaymentOrderDisplayStatus = /* §21.7 */;
export type PaymentReconciliationResult = /* §19.5 白名单 */;
```

旧类型 `AdminPaymentChannelStatus / PaymentChannelId / AdminPaymentRow / ReconciliationBatch*` 在 Phase 4 前保留；删除前必须 `rg` 确认无引用。不要用 `any` 遮掩旧类型冲突。

### 21.10 路由、导航与重定向

`frontend/src/pages/admin/AdminDashboardPage.tsx`：

```tsx
const AdminPaymentsPage = lazyAdminPage(
  () => import('./payments/AdminPaymentsPage'),
  'AdminPaymentsPage',
);

// 财务组
<Route path="payments" element={<AdminPaymentsPage />} />
<Route path="payment-channels" element={<Navigate to="/admin/payments?tab=providers" replace />} />
<Route path="reconciliation" element={<Navigate to="/admin/payments?tab=reconciliation" replace />} />
<Route path="reconciliation/batches/:id" element={<Navigate to="/admin/payments?tab=reconciliation" replace />} />
```

保留旧路径重定向至少一个大版本；告警/值班深链改完后也不要立刻删除，避免外部书签 404。

`frontend/src/components/admin/adminNav.ts` 财务组改为：

```ts
{ path: '/admin/payments', label: '支付充值', permission: 'payment.read' },
{ path: '/admin/invoices', label: '发票管理', permission: 'invoice.write' },
```

移除 `/admin/payment-channels` 与 `/admin/reconciliation` 两个导航项，但保留路由重定向。原因是两个入口并存会让用户以为「支付渠道」与「支付充值」是不同数据源。

### 21.11 权限与五态

页面按权限裁剪：

| 能力 | 前端条件 | 无权限表现 |
| --- | --- | --- |
| 查看页面 | `payment.read` | 导航不显示；直接访问由后端 403，页面显示无权限态 |
| 保存渠道配置 | `payment.write` | 「配置」按钮仍可查看，保存按钮隐藏 |
| 查单/关单 | `payment.operate` | 行操作只留「详情」 |
| 商品编辑 | `product.write` | 隐藏新增/编辑，保留只读列表 |
| 执行对账/导入 | `finance.reconcile` | 执行区禁用并说明原因 |
| 导出 | `payment.read + data.export` | 隐藏导出按钮；后端仍校验 |

每个列表统一处理五态：首屏 loading（`AdminListLoading`/Skeleton）、有数据、空态（说明原因）、失败（`AdminListError` + 重试，已有数据保留并显示 `AdminStaleError`）、无权限（403 文案，不显示「重置密码」等误导操作）。

## 22. 状态派生工具与 Prisma where 映射

### 22.1 支付订单展示状态

展示状态不落库。后端在列表/详情投影时计算一次，返回 `status`；前端用同一规则做本地断言，但**不以本地计算覆盖服务端返回值**。

优先级从高到低：

| 顺序 | displayStatus | 判定 | 文案/色调 | 可查单 | 可关单 |
| --- | --- | --- | --- | --- | --- |
| 1 | `closing` | `rawStatus='pending'` 且 `closeStartedAt > now-5min` | 关单中 / warning | ✅ | ✅ |
| 2 | `credited` | `rawStatus='paid'` | 已入账 / success | ❌ | ❌ |
| 3 | `refunded` | `rawStatus='refunded'` | 已退款 / neutral | ❌ | ❌ |
| 4 | `partial_refunded` | `rawStatus='partial_refunded'` | 部分退款 / warning | ❌ | ❌ |
| 5 | `closed` | `rawStatus='cancelled'` | 已关闭 / neutral | ❌ | ❌ |
| 6 | `create_failed` | `rawStatus='pending'` 且 `lastError` 非空，且不在关单租约内 | 下单失败 / danger | ✅ | ✅ |
| 7 | `pending` | `rawStatus='pending'` 且已固定渠道/已生成 checkout，且无 `lastError` | 待支付 / warning | ✅ | ✅ |
| 8 | `created` | 其余 `rawStatus='pending'` | 创建中 / info | ❌ | ✅ |

说明：

- 「已入账」只取 `Order.paidAt`，不新增 `creditedAt`（A5）。
- `refunded` / `partial_refunded` 用 Order 原始状态判断，不用金额二次推断；退款服务已经在同一事务里把状态与 `refundedCents` 对齐。
- `closing` 超过 5 分钟视为租约失效：worker 会回收；前端不应永远显示「关单中」。
- `create_failed` 在用户重新发起成功后必须清除 `lastError`；否则会一直显示失败。
- `canQuery` 还要求存在 `channel` 与可解析配置；`canClose` 还要求订单归属/权限满足。表格中的布尔值是 UI 基线，最终由后端 `actions` 与权限共同裁剪。

伪代码：

```ts
function paymentStatusOf(input: {
  rawStatus: string;
  closeStartedAt: Date | null;
  lastError: string | null;
  providerConfigId: string | null;
  checkoutMode: string | null;
}, now = new Date()): PaymentDisplayStatus {
  if (input.rawStatus === 'paid') return 'credited';
  if (input.rawStatus === 'refunded') return 'refunded';
  if (input.rawStatus === 'partial_refunded') return 'partial_refunded';
  if (input.rawStatus === 'cancelled') return 'closed';
  if (input.rawStatus !== 'pending') return 'created'; // 未知 raw 状态不静默吞掉
  if (input.closeStartedAt && input.closeStartedAt > new Date(now.getTime() - 5 * 60_000)) {
    return 'closing';
  }
  if (input.lastError) return 'create_failed';
  if (input.providerConfigId || input.checkoutMode) return 'pending';
  return 'created';
}
```

### 22.2 展示状态 → Prisma `where`

先定义固定基线。**租约边界必须每次请求重新计算**：`closeLease` 若写成模块顶层常量，会冻结在进程启动时刻，运行几分钟后所有「关单中」都变成历史状态。

```ts
const PRODUCT_ORDER_BASE = { items: { some: {} } } satisfies Prisma.OrderWhereInput;
const CLOSE_LEASE_MS = 5 * 60_000;

export function closeLeaseOf(now: Date): Date {
  return new Date(now.getTime() - CLOSE_LEASE_MS);
}
```

`paymentOrderWhere(status, closeLease)` 返回下面的条件。外层由 `buildAdminPaymentOrderWhere(q, now = new Date())` 把它和商品订单基线一起放进 `AND` 数组，禁止直接 spread 造成键覆盖；列表、`count`、导出共用同一个 `now` 和同一个 builder，避免分页途中状态边界漂移：

```ts
export function paymentOrderWhere(
  status: PaymentDisplayStatus,
  closeLease: Date,
): Prisma.OrderWhereInput {
  switch (status) {
    case 'credited':
      return { status: 'paid' };

    case 'refunded':
      return { status: 'refunded' };

    case 'partial_refunded':
      return { status: 'partial_refunded' };

    case 'closed':
      return { status: 'cancelled' };

    case 'closing':
      return { status: 'pending', closeStartedAt: { gt: closeLease } };

    case 'create_failed':
      return {
        status: 'pending',
        lastError: { not: null },
        OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }],
      };

    case 'created':
      return {
        status: 'pending',
        providerConfigId: null,
        checkoutMode: null,
        lastError: null,
        OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }],
      };

    case 'pending':
      return {
        status: 'pending',
        lastError: null,
        OR: [{ providerConfigId: { not: null } }, { checkoutMode: { not: null } }],
        AND: [{ OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: closeLease } }] }],
      };

    default:
      throw new AppError(40001, '订单状态筛选值非法', 400);
  }
}
```

注意：

- Prisma 同一对象同时出现顶层 `OR` 与 `AND` 是合法且为「AND 合并」；代码评审时优先写 `AND: [...]` 数组，保持可读。
- `lastError: { not: null }` 在 SQLite 仍会命中空串。写入层已把空串归一化为 `null`（§22.6），但迁移期旧数据可能残留空串。**必须先跑 §19.8 第 6 步清洗**；若不能清洗，`create_failed / created / pending` 三个分支都要把 `lastError` 条件改成「null 或空串」，只改 `create_failed` 会让订单从三个状态里同时消失。
- `closing` 与 `create_failed` 的边界用 `gt` / `lte` 严格互补，恰好 5 分钟的订单归入「失败/普通 pending」，不会两边都不命中。

### 22.3 关键字、渠道与时间映射

```ts
const keyword = q.keyword?.trim();
const keywordWhere = keyword ? {
  OR: [
    { orderNo: { contains: keyword } },
    { providerTradeNo: { contains: keyword } },
    { userId: { equals: keyword } },
    { user: { is: { OR: [
      { name: { contains: keyword } },
      { email: { contains: keyword } },
    ] } } },
    { items: { some: { nameSnapshot: { contains: keyword } } } },
  ],
} : {};

const channelWhere = q.providerId ? { channel: q.providerId } : {};

const timeWhere = (() => {
  if (!q.from && !q.to) return {};
  const field = q.timeField === 'paid' ? 'providerPaidAt'
    : q.timeField === 'credited' ? 'paidAt'
    : 'createdAt';
  return { [field]: { gte: startOfShanghaiDay(q.from), lte: endOfShanghaiDay(q.to) } };
})();
```

边界规则：

- `from` 缺省且 `to` 有值：从 `to` 当天 00:00 起算不合理，按「不限制开始」处理；`to` 缺省则「不限制结束」。两者都有时要求 `from <= to`。
- `providerPaidAt` 对历史空值不 fallback 到 `paidAt`；否则「支付时间」与「入账时间」筛选结果相同，失去区分意义。旧数据回填见 §19.8。
- `keyword` 上限 120；只通过 Prisma `contains` 交给参数化 LIKE，不拼 SQL。用户输入里的 `%` / `_` 仍会被 SQLite LIKE 当通配符解释 —— 不是注入，但会扩大匹配面；要么在 DTO 层拒绝这两个字符，要么在搜索框提示「支持部分匹配」，不要为此手写 `$queryRaw`。SQLite 默认 ASCII 大小写不敏感；中文按原样匹配，Prisma SQLite 也不支持 `mode: 'insensitive'`。
- `sort` 白名单：`createdAt / providerPaidAt / paidAt / amountCents`；方向缺省 `desc`。其它值返回 `40001`，不能把字段名原样拼进 SQL。

> 上面的代码只表达口径；最终实现以 §23.2 的单边日期处理和 §23.7 的精确+部分匹配版本为准，避免 `gte: undefined` 与重复 OR 分支。

### 22.4 商品销售状态

| saleStatus | 判定 | 文案 | 色调 | canPurchase |
| --- | --- | --- | --- | --- |
| `disabled` | `status!='active'` | 已停用 | neutral | false |
| `upcoming` | `timed` 且 `now < saleStartAt` | 待发售 | info | false |
| `ended` | `timed` 且 `now > saleEndAt` | 已结束 | warning | false |
| `sold_out` | `inventory` 且 `stockRemaining<=0` | 已售罄 | warning | false |
| `on_sale` | 其余 active 商品 | 销售中 | success | 再校验周期次数/币种渠道 |

`canPurchase` 最终还受：

- 商品币种存在可用渠道（USD 尤其）；
- `periodic` 的窗口购买次数未用尽；
- `inventory` 的 `stockRemaining >= quantity`；
- 用户未被禁用；
- 订单金额 > 0（0 元商品继续走原有免费领取入口）。

页面的「销售中」不等于可购买：按钮启用条件以 `canPurchase` 为准，不能只看 `status='active'`。

### 22.5 对账展示状态

运行状态：

| status | 文案 | 色调 | 明细可看 | 明细可导出 |
| --- | --- | --- | --- | --- |
| `running` | 执行中 | info | ✅（当前已写入的行） | ❌ |
| `completed` | 已完成 | success | ✅ | ✅ |
| `failed` | 失败 | danger | ✅（可能为空） | ❌ |

明细结果不变：`matched / recovered / local_order_not_found / provider_record_missing / amount_mismatch / trade_no_mismatch / credit_failed`。`result=abnormal` 不是数据库值，只是查询别名。

`resolved` 在自动对账结果里表示「本次运行已自动处理」，不是人工结案；页面主列展示 `result`，`resolved` 只在说明中体现。人工处置仍走 `/admin/orders`，避免对账工具直接改钱。

### 22.6 空值、空串与终态语义

| 字段 | `null` | 空串 `''` | 终态要求 |
| --- | --- | --- | --- |
| `Order.checkoutValue` | 从未生成过支付动作（历史/0 元单） | 曾生成但已失效/清空 | 已到账/已关闭/已退款必须为 `''` |
| `Order.lastError` | 无错误 | 非法；写入前归一化为 `null` | 支付成功后 `null` |
| `Order.providerTradeNo` | 尚未拿到渠道交易号 | 非法；归一化为 `null` | 已支付必须有值（free/manual 也写前缀号） |
| `Order.providerStatus` | 渠道未返回 | 允许；展示时当 `—` | 不参与本地状态机 |
| `Order.closedAt` | 未关闭 | 不适用 | `cancelled` 必须有值 |
| `Order.providerPaidAt` | 渠道未给支付时间 | 不适用 | 已支付尽量有值，缺失时详情显示 `—` |
| `Payment.payTransactionId` | pending 尝试 | 非法；归一化为 `null` | succeeded 必须唯一非空 |
| `Payment.lastError` | 无错误 | 非法；归一化为 `null` | failed 尽量有值 |
| `PaymentNotification.lastError` | 无错误 | 非法；归一化为 `null` | failed 必须有值 |
| `PaymentReconciliationRun.error` | 无错误 | 非法；归一化为 `null` | failed 必须有值 |
| `PaymentReconciliationItem.detail` | 无补充 | 允许；前端显示默认说明 | — |
| `config.values[secret]` | 不存在 | 保存时表示「沿用上一版」 | 不允许删除 secret |

序列化时统一把空串规范成 `null`（除 `checkoutValue` 有明确空串语义外）；后端 DTO 用 `@Transform(({value}) => value === '' ? null : value)`，不要靠前端自觉。

### 22.7 金额与币种不变量

- 一个订单只有一个币种；商品、支付尝试、对账明细的币种必须与订单一致。
- 不做汇率换算；USD 商品只能用支持 USD 的渠道，CNY 商品只能用支持 CNY 的渠道。
- 金额始终为整数最小单位；比较时严格 `===`，不做浮点容差。
- `Order.paidCents` 是实付；`Payment.amountCents` 必须等于实付，不是原价。
- 0 元单只允许 `mode='free'`，不创建 pending Payment，不调渠道。
- 退款不改变 `Payment.amountCents`；以 `Order.refundedCents` 与 Refund 表为准。

## 23. 列表查询落地：投影、排序、分页与导出

§22 只定义了「展示状态 → where」。这一节把 where 变成可上线的查询实现，明确列表、计数、导出必须共用同一套条件，避免三处各写一份后筛选结果对不上。

### 23.1 单一 where builder

```ts
// backend/src/admin/payments/payment-query.ts
export interface AdminPaymentOrderQuery {
  status?: PaymentDisplayStatus;
  keyword?: string;
  providerId?: string;
  timeField?: 'created' | 'paid' | 'credited';
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sort?: string;
}

export function buildAdminPaymentOrderWhere(
  q: AdminPaymentOrderQuery,
  now = new Date(),
): Prisma.OrderWhereInput {
  const parts: Prisma.OrderWhereInput[] = [{ items: { some: {} } }];

  if (q.status) parts.push(paymentOrderWhere(q.status, closeLeaseOf(now)));
  if (q.providerId) parts.push({ channel: q.providerId });
  const keyword = normalizeKeyword(q.keyword);
  if (keyword) parts.push(paymentKeywordWhere(keyword));
  const range = shanghaiDayRange(q.from, q.to);
  if (range) parts.push({ [timeFieldColumn(q.timeField)]: range });

  return { AND: parts };
}
```

约束：

- 只返回 `Prisma.OrderWhereInput`，不执行查询；列表、`count`、导出、测试都调用它，禁止复制条件。
- `providerId` 先对照适配器注册表白名单（`sandbox / alipay / wechat`），未知值 `40001`，不要静默返回空列表。
- `status` 先按 8 个展示状态白名单校验，未知值 `40001`。
- `timeField` 缺省 `created`；非法值 `40001`。
- `keyword` 去首尾空格、限 120 字符；空串不加入 `AND`，避免生成无意义的 `contains: ''`。
- 所有子条件都进 `AND` 数组；子条件内部的 `OR` 不会互相覆盖。

### 23.2 时间边界

```ts
export function shanghaiDayRange(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const start = from ? startOfShanghaiDay(from) : undefined;
  const end = to ? endOfShanghaiDay(to) : undefined;
  if (start && end && start > end) {
    throw new AppError(40001, '开始日期不能晚于结束日期', 400);
  }
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}
```

规则：

- `startOfShanghaiDay / endOfShanghaiDay` 接收 `YYYY-MM-DD` 字符串并在内部调用 `parseDateStrict`；后者只接受 `YYYY-MM-DD`，并用「解析后回写字符串是否相同」校验真实日历日；`2026-02-30` 必须 `40001`，不能靠 `new Date()` 自动滚到 3 月。
- 时区固定 `Asia/Shanghai`（当前无夏令时，可按 `+08:00` 计算）：`from` 取当天 `00:00:00.000`，`to` 取当天 `23:59:59.999`。
- 只有 `from` 时只加 `gte`；只有 `to` 时只加 `lte`；同一天允许（`gte 00:00` + `lte 23:59:59.999`）。
- `timeField` 映射固定：`created → createdAt`、`paid → providerPaidAt`、`credited → paidAt`。
- `providerPaidAt` 为空的历史订单不会命中 `paid` 时间筛选，**不 fallback 到 `paidAt`**；否则「支付时间」和「入账时间」两个口径会得到同一批结果，筛选失去意义。

### 23.3 排序与分页稳定性

```ts
const SORT_COLUMNS = {
  createdAt: 'createdAt',
  providerPaidAt: 'providerPaidAt',
  paidAt: 'paidAt',
  amountCents: 'paidCents',
} as const;

export function orderByOf(sort?: string): Prisma.OrderOrderByWithRelationInput[] {
  const parts = (sort ?? 'createdAt:desc').split(':');
  if (parts.length > 2) throw new AppError(40001, '排序字段非法', 400);
  const [field, direction = 'desc'] = parts;
  const column = SORT_COLUMNS[field as keyof typeof SORT_COLUMNS];
  if (!column || (direction !== 'asc' && direction !== 'desc')) {
    throw new AppError(40001, '排序字段非法', 400);
  }
  const dir = direction as Prisma.SortOrder;
  const nullable = column === 'providerPaidAt' || column === 'paidAt';
  return [
    nullable ? { [column]: { sort: dir, nulls: 'last' } } : { [column]: dir },
    { id: 'asc' }, // 同时间戳的稳定次序，避免翻页重复/漏行
  ] as Prisma.OrderOrderByWithRelationInput[];
}
```

规则：

- 默认 `createdAt:desc`；金额排序按 `paidCents`，依赖 §19.8 的历史回填，否则旧支付单会全部按 0 排在最后。
- `nulls: 'last'` 只对可空列（`providerPaidAt / paidAt`）使用；`createdAt`、`paidCents` 非空，传 `SortOrderInput` 会过不了 Prisma 类型，必须走普通 `SortOrder` 分支。
- 必须带次排序 `id`。仅按 `createdAt` 排序时，同一毫秒创建的多笔订单在 `LIMIT/OFFSET` 下可能跨页重复或漏掉。
- `sort` 只接受 `field:asc|desc`；不接受空方向、额外冒号、SQL 片段。方向缺省按 `desc` 只用于兼容旧链接，新前端始终显式传。

### 23.4 列表投影与 N+1

列表只取页面用到的字段，禁止 `include: { items: { include: { product: true } }, user: true, payments: true }`：

```ts
const ORDER_LIST_SELECT = {
  id: true,
  orderNo: true,
  userId: true,
  channel: true,
  status: true,
  totalCents: true,
  discountCents: true,
  paidCents: true,
  refundedCents: true,
  currency: true,
  providerConfigId: true,
  providerConfigVersion: true,
  providerTradeNo: true,
  providerStatus: true,
  checkoutMode: true,
  checkoutValue: true,
  checkoutExpiresAt: true,
  providerPaidAt: true,
  paidAt: true,
  closedAt: true,
  lastError: true,
  closeStartedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true } },
  items: {
    select: { nameSnapshot: true, creditsSnapshot: true, quantity: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.OrderSelect;
```

派生字段：

- `productName`：`items[0].nameSnapshot`；多商品订单显示 `{首项} 等 {items.length} 项`，不 join `Product`（历史快照才是事实）。
- `credits`：未支付用 `Σ creditsSnapshot × quantity`；已支付/已退款用 `Order.grantedCredits`（退款回收后可能与快照不同）。
- `amountCents`：`paidCents > 0 ? paidCents : max(totalCents - discountCents, 0)`，兼容未回填的历史单；0 元免费单保持 0。
- `user` 缺失时返回 `null`，前端显示「用户不存在」+ 截断 `userId`，不能因为关联缺失让整行消失。
- 列表不返回 `payments`；详情才返回最近 50 条支付尝试（`orderBy createdAt desc, take 50`），超过时页面注明「仅显示最近 50 次」。
- 任何响应都不返回 `rawPayload / configCipher / payloadCipher / secret`。

`productName` 的 `items` 全量加载只在单订单商品数很大时才有成本；本仓库充值订单通常 1–3 项。若未来出现批量下单，可改为 `_count` + `take: 1`，但仍禁止 join `Product`。

### 23.5 分页与计数

```ts
const page = q.page;              // DTO: @IsInt @Min(1) @Max(10000)
const pageSize = q.pageSize;      // DTO: @IsInt @Min(1) @Max(100)
const where = buildAdminPaymentOrderWhere(q);

const total = await prisma.order.count({ where });
const skip = (page - 1) * pageSize;
if (total === 0 || skip >= total) {
  return { items: [], total, page, pageSize };
}
const rows = await prisma.order.findMany({
  where,
  select: ORDER_LIST_SELECT,
  orderBy: orderByOf(q.sort),
  skip,
  take: pageSize,
});
return { items: rows.map(toAdminPaymentOrderRow), total, page, pageSize };
```

- 先 `count` 再 `findMany`：页码超出总页数时直接返回空页，避免 `OFFSET` 很大时仍扫表；不返回 400，删除数据后刷新不应报错。
- `count` 与 `findMany` 之间新订单插入可能让边界轻微漂移；后台列表接受这一点。若要求严格快照，再包 `$transaction([count, findMany])`，但不要为此加锁。
- `pageSize` 非法（非整数、0、>100）走 DTO 校验 `40001`，不静默截断；页码同理。
- 订单默认 30，运行列表默认 30，对账明细默认 50；对应 DTO 默认值与前端首屏参数必须一致，避免首屏请求 20、刷新后变 30。

### 23.6 索引落地

§19.2 需要补齐以下索引（已有项不重复加）：

```prisma
  @@index([providerPaidAt])
  @@index([channel, providerPaidAt])
  @@index([channel, paidAt])
  @@index([status, paidAt])
```

对应关系：

| 查询 | 命中索引 |
| --- | --- |
| 默认 `createdAt desc` | `[createdAt]`、`[status, createdAt]` |
| 状态 + 创建时间 | `[status, createdAt]` |
| 渠道 + 创建时间 | `[channel, status, createdAt]`（最左 `channel` 可用） |
| 支付时间筛选/排序 | 新增 `[providerPaidAt]`、`[channel, providerPaidAt]` |
| 入账时间筛选/排序 | `[paidAt]`、`[status, paidAt]`、新增 `[channel, paidAt]` |
| 精确订单号/交易号 | `orderNo`、`providerTradeNo` 唯一索引 |
| 用户 ID 精确搜索 | `[userId, status]` 的最左 `userId` |

`keyword` 的 `contains` 会产生前导通配符，B-tree 索引帮不上；当前规模先接受在状态/时间过滤后的扫描。订单量超过 10 万再评估 SQLite FTS5，不在本轮引入。`create_failed` 的 `lastError` 过滤选择性很低，不单独加索引。

### 23.7 关键字匹配

```ts
function paymentKeywordWhere(keyword: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { orderNo: { equals: keyword } },
      { providerTradeNo: { equals: keyword } },
      { orderNo: { contains: keyword } },
      { providerTradeNo: { contains: keyword } },
      { userId: { equals: keyword } },
      { user: { is: { OR: [
        { name: { contains: keyword } },
        { email: { contains: keyword } },
      ] } } },
      { items: { some: { nameSnapshot: { contains: keyword } } } },
    ],
  };
}
```

- 先放精确匹配，给 SQLite 优化器留出用唯一索引的机会；后面的 `contains` 负责部分匹配。
- 不把用户输入拼进 `$queryRaw`；Prisma 参数化会处理引号与注入。
- `%` / `_` 仍是 LIKE 通配符（见 §22.3）；如果产品要求「标点按字面匹配」，必须在 DTO 层拒绝并给出明确文案，不能只在前端替换。
- `normalizeKeyword` 只做 `trim()` 和长度校验；不合并内部空格，不改变大小写。SQLite 对 ASCII 大小写不敏感、对中文按原样匹配；不要写 `mode: 'insensitive'`（SQLite connector 不支持）。
- `keyword` 命中不会绕过权限与固定条件 `items: { some: {} }`；会员订单仍不混入。

### 23.8 导出

```ts
const EXPORT_LIMIT = 10_000;
const rows = await prisma.order.findMany({
  where: buildAdminPaymentOrderWhere(q), // 忽略 page/pageSize
  select: ORDER_EXPORT_SELECT,
  orderBy: orderByOf(q.sort),
  take: EXPORT_LIMIT + 1,
});
const truncated = rows.length > EXPORT_LIMIT;
if (truncated) res.setHeader('X-Export-Truncated', 'true');
sendCsv(res, 'payment-orders', toCsv(PAYMENT_ORDER_CSV_COLUMNS, rows.slice(0, EXPORT_LIMIT)));
```

- 导出与列表共用 `where` 和 `orderBy`，只忽略分页；不允许导出接口单独实现一套筛选。
- 多取 1 行判断截断，响应头 `X-Export-Truncated: true`；前端可在 toast 提示「已导出前 10000 行」。不要往 CSV 里插说明行，否则列数会错。
- `sendCsv` 内部已处理 UTF-8 BOM、公式注入与文件名；不要再手写 `Content-Disposition`。
- 导出列按 §20.6；金额用 `effectiveAmountCents`，状态用展示状态文案，时间按 `Asia/Shanghai` 格式化。
- 必须同时挂 `@RequireAllPermissions('payment.read', 'data.export')` 与 `@AuditAction('data.export')`；审计记录筛选条件摘要，不记录密钥、checkout URL、完整用户邮箱列表。
- 前端在「草稿与应用值不同」时禁用导出，后端仍以实际 query 为准，不能信任前端。

### 23.9 查询层测试清单

| 用例 | 断言 |
| --- | --- |
| 8 个展示状态 ↔ where | 构造每种状态的订单 fixture，`findMany(where)` 的 id 集合与 `paymentStatusOf` 结果一致 |
| 5 分钟边界 | `closeStartedAt = now-5min` 不归 `closing`；`now-5min+1ms` 归 `closing` |
| `lastError` 空串 | 迁移前空串不应显示为「下单失败」，或迁移脚本先清洗为 `null` |
| 日期 | 仅 from / 仅 to / 同一天 / 非法日历日 / from>to |
| 排序 | 非法字段 `40001`；`providerPaidAt` 空值排最后；同时间戳按 id 稳定 |
| 分页 | 页码超出总页数返回空 items；pageSize=101 `40001`；page=0 `40001` |
| 关键字 | 订单号、交易号、姓名、邮箱、商品名、用户 ID 均可命中；空串不产生条件 |
| 导出 | 10001 行只输出 10000 行并带截断头；0 行时前端禁用、后端仍返回表头 |
| 索引 | `PRAGMA index_list('Order')` 包含 §23.6 的新索引；`EXPLAIN QUERY PLAN` 抽查状态+时间与渠道+时间 |

### 23.10 实现顺序

1. 先落 `payment-query.ts` 的纯函数与表驱动单测，不接控制器；确保 8 个展示状态与 where 一一对应。
2. 再接 `GET /orders` 与 `count`，用手工 fixture 对比列表 id 与 `paymentStatusOf`；此时不接导出。
3. 详情投影单独实现，确认 `payments` 只取最近 50 条且不含 `rawPayload`。
4. 最后接导出，复用同一 builder；补 10001 行截断测试与审计断言。
5. 上线前跑 `PRAGMA index_list('Order')` 与 `EXPLAIN QUERY PLAN`，确认新索引真实生效；SQLite 不会因为 Prisma schema 写了索引就自动重建，必须实际执行 `db push`。

## 24. 页面复刻对照与偏差登记

### 24.1 基线

- 参考文件：`open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`（1180 行）与其引用的 `admin-ui` 组件；以当前工作区版本为准。
- 「一致」指：标签顺序、可见文案、列顺序与含义、筛选默认值、空/错/加载态、抽屉标题与宽度、按钮可用条件一致。
- 「偏差」指：本仓库没有对应概念，或照搬会与本仓库安全/资金规则冲突；每一条都必须登记，不能默默改。
- 视觉上使用 shadcn + `admin-ui` 原语，不追求与 antd 像素级相同；间距、圆角、字体跟随现有后台页面。

### 24.2 逐屏对照

| 区域 | 参考页 | 本方案 | 结论 |
| --- | --- | --- | --- |
| 页面头 | 「支付充值」+ 描述 + 刷新 | 同文案；刷新只刷当前标签 | 一致 |
| 通知条 | 「平台不提供支付退款」 | 改为「退款请到订单管理」 | 有意偏差 E1 |
| 标签 | 支付渠道 / 充值商品 / 支付订单 / 支付对账，默认渠道 | 同顺序同默认；`tab` 写 URL | 一致 + 增强 |
| 渠道表 | 渠道图标/名称/id、支付方式、状态+插件副行、关闭分钟、版本、配置 | 同列；去掉插件副行，保留「配置/缺项」副行；空态「没有发现支付渠道」 | 偏差 E2 |
| 渠道抽屉 | 620 宽、启用、关闭分钟、动态字段、保存新版本 | 同宽同字段；secret 留空沿用 | 一致 + 安全增强 |
| 商品工具栏 | 默认充值货币、新增商品 | 同；切换货币前 ConfirmAction | 一致 |
| 商品列 | 商品/说明、售价、权益、排序、上架策略、状态、操作 | 同列；权益用整数积分并附有效期；发放方式只在编辑抽屉中设置 | 偏差 E3 |
| 商品空态 | 「还没有充值商品」 | 同文案 | 一致 |
| 商品抽屉 | 520 宽、新增/编辑、保存 | 同；storage 选项禁用并说明 | 偏差 E4 |
| 订单搜索 | placeholder「搜索名称、用户名、邮箱、订单号」 | 同文案；回车查询 | 一致 |
| 订单筛选 | 状态、渠道、时间口径、RangePicker | 同四项；日期用原生 `input type=date` 起止两个 | 偏差 E5 |
| 订单按钮 | 「查询」、脏提示、导出 CSV | 同文案；新增「重置」 | 一致 + 增强 |
| 订单列 | 用户、订单/商品、渠道、金额/权益、状态、创建时间、操作 | 同列同宽；状态扩到 8 个 | 偏差 E6 |
| 订单空态 | 「没有支付订单」，有筛选时区分 | 同 | 一致 |
| 订单分页 | 30/页 | 30/页，选项 30/50/100 | 一致 + 修正参考页选项缺 30 |
| 订单详情 | 680 宽；用户可点开内嵌用户抽屉；无 payments 历史 | 680 宽；用户跳 `/admin/users?id=`；增加 payments 历史、配置版本、失败原因 | 偏差 E7 + 增强 |
| 对账执行区 | 渠道、日期、执行对账、10:15 自动对账文案 | 同；渠道只列已配置且支持对账；新增原因确认 | 一致 + 收紧 |
| 对账运行列 | 账单日期、渠道、状态、一致、自动补发、异常、完成时间、明细 | 同列；默认 30/页 | 一致 |
| 对账空态 | 「还没有对账记录」 | 同 | 一致 |
| 对账明细 | 1080 宽；结果筛选、刷新、导出、分页 | 同；默认 50/页；失败 run 顶部展示 error | 一致 |
| 明细空态 | failed→「本次对账未生成明细」，否则「账单没有交易记录」 | 同 | 一致 |
| 五态 | antd message + 表格 loading/empty | `AdminListLoading/AdminListError/AdminStaleError/EmptyState` + 403 页 | 一致 + 组件化 |

### 24.3 有意偏差登记

| # | 偏差 | 原因 | 验收影响 |
| --- | --- | --- | --- |
| E1 | 通知条不再说「平台不提供支付退款」 | 本仓库有完整退款链路，照抄会误导 | 文案评审确认 |
| E2 | 渠道状态去掉「插件已开放/停用」副行，空态去掉「插件」二字 | 本仓库支付是适配器注册表，没有宿主插件运行时 | 不影响操作 |
| E3 | 积分显示整数，不显示 6 位小数微积分 | 本仓库积分域是整数（D6） | 金额/权益列格式 |
| E4 | 存储扩容选项保留但禁用 | 没有配额子系统（D7） | 商品抽屉 |
| E5 | 日期用两个原生 date，而非 RangePicker | 后台 35 页统一用原生 date；不引入 antd | 交互等价 |
| E6 | 订单状态 8 个（增加已退款/部分退款） | 参考页没有退款态，但不映射会让退款单显示成已入账 | 状态筛选 |
| E7 | 点用户跳 `/admin/users?id=`，不内嵌用户抽屉 | 用户详情抽屉目前内嵌在 `AdminUsersPage`，未抽成可复用组件；不为一个入口做跨页重构 | 多一次跳转 |
| E8 | 订单详情增加 payments 历史、配置版本、失败原因 | 参考页缺少排障信息；本仓库有这些数据 | 详情更完整 |
| E9 | 对账执行渠道只列 configured + supportsReconciliation | 参考页仍列出未配置项并置灰（不可选）；本方案直接不列，减少误操作。空列表要说明「没有可对账的渠道」 | 空列表需说明 |
| E10 | 对账/关单收集原因，配置变更不收集 | 对账/关单需要业务依据；渠道配置保存仍写审计，但不增加操作门槛 | 部分操作多一步确认 |
| E11 | 订单筛选新增「重置」 | 参考页只能逐项清空 | 纯增强 |
| E12 | 分页选项补 30 | 参考页 pageSize=30 但选项是 20/50/100，下拉值不在选项里 | 修正参考页缺陷 |

偏差 E1–E7 需要在评审时逐条确认；默认原则是「能一致就一致，不一致必须有理由」。E8–E12 是纯增强，不改变参考页的操作路径。

### 24.4 不可偏差清单

以下内容必须逐字/逐项对齐，代码评审按此清单勾选：

- 四个标签的文案与顺序：支付渠道、充值商品、支付订单、支付对账；默认支付渠道。
- 订单搜索 placeholder：「搜索名称、用户名、邮箱、订单号」。
- 草稿变更提示：「请先查询以应用筛选条件」。
- 按钮文案：查询、导出 CSV、新增商品、编辑商品、保存、保存新版本、执行对账、筛选、刷新、导出汇总 CSV、导出明细 CSV。
- 空态：没有支付订单、还没有充值商品、还没有对账记录、本次对账未生成明细、账单没有交易记录。
- 抽屉标题与宽度：配置 {name} 620、支付订单详情 680、新增/编辑商品 520、对账明细 1080。
- 对账自动执行文案：「系统每天 10:15 后自动对账昨日账单；也可在此手动重跑最近三个月账单。」
- 渠道支付方式：扫码支付 / 网站跳转 / 站内模拟。
- 订单状态颜色：创建中 info、待支付 warning、关单中 warning、下单失败 danger、已关闭 neutral、已入账 success、已退款 neutral、部分退款 warning。
- 对账结果颜色：一致 success、已自动补发 info、其余异常 danger。
- 行操作只显示当前状态可执行项：已入账/已关闭只剩详情；关单只出现在 created/pending/create_failed/closing。
- 页面不出现退款按钮；退款链接指向 `/admin/orders?orderNo=...`。
- 不引入 antd；不出现 `amountFen`、`creditsMicrocredits` 等参考实现字段名。

### 24.5 验收步骤

1. 准备数据：至少覆盖 8 个订单状态各 1 笔、3 个渠道各 1 条配置、5 个商品（含限时/库存/周期各 1）、2 个对账 run（completed + failed）及每类 result 明细。
2. 以 admin / finance / operator 三个角色分别进入：确认导航、按钮、行操作、导出与执行对账的可见性符合 §21.11。
3. 桌面 1440×900 逐标签截图：默认态、筛选后、空态、加载态、接口 500、403。
4. 逐个打开四个抽屉：确认标题、宽度、字段顺序、复制按钮、关闭后 URL 参数清除。
5. 深链：`?tab=orders&status=created&from=...`、`?tab=orders&orderId=...`、`?tab=reconciliation&runId=...` 刷新后可复原；非法 tab/status 回默认且不报错。
6. 键盘：Tab 切换、方向键切换标签、抽屉焦点陷阱与 Esc 关闭、筛选控件 aria-label 可读。
7. 窄屏 1024/768：表格横向滚动、操作列固定右侧、抽屉满宽。
8. 边界数据：0 元免费单、`paidCents=0` 的历史支付单、用户已删除/不存在、超长商品名与订单号、`providerPaidAt=null` 的已支付单。
9. 状态边界：`closeStartedAt` 恰好 5 分钟前后各 1 笔，确认「关单中」与「下单失败/待支付」不重不漏。
10. 回归：`/admin/payment-channels`、`/admin/reconciliation` 重定向到新标签；旧告警深链不 404。

### 24.6 复刻完成定义（DoD）

- 参考页每个可见字符串都能在 §24.2 找到「一致」或 §24.3 的偏差编号；没有未登记的改动。
- 四个标签均可 URL 直达，刷新不丢筛选与详情。
- 三档权限、五态、八个订单状态、七种对账结果都有可见验收记录。
- 不新增 antd、不新增状态管理库；组件全部复用 `admin-ui`/shadcn。
- 浏览器控制台无未处理异常，接口失败时页面保留旧数据并给出可重试提示。
- 截图与验收记录附在 PR 描述中；偏差项由产品/设计确认后再合并。

---

## 25. 实现进度与开放差距

> **核对基线**：commit `505319c`（2026-11-01）。参考实现：`/Users/bright/github/open-ai-canvas`。
>
> 本节只记录「当前代码做到哪、与参考实现还差什么」，不替代 §1–§24 的目标规格；与代码冲突时以代码为准。后续每完成一项，直接改本节的 ✅ / ❌，不另建进度文档。

### 25.1 总体结论

- **后端支付域主链路已落地**：渠道配置加密版本化、支付宝/微信/沙箱适配器、发起支付、查单/关单、回调收件箱、15s worker、T+1 对账、后台支付 API。
- **前端只完成了 C 端结算页的基础支付**：跳转 / 二维码 / 沙箱 / 0 元单、轮询、续付。
- **后台 `/admin/payments` 四标签页未实现**；旧后台支付渠道 / 对账页仍在路由里，但后端旧控制器已删除，当前打开会请求不存在的接口。
- **后端支付域没有单元/集成 spec**；`smoke-payments.js` 仍在测旧 `/admin/reconciliation/*` 路径。
- 文档此前状态为「未实施」，与实际代码不符；本节即修正后的现状记录。

### 25.2 已对齐能力

| 能力 | 本仓库落点 | 状态 |
| --- | --- | --- |
| 渠道配置加密、追加写版本化、身份字段锁定 | `payment-config.service.ts`、`PaymentProviderConfig` | ✅ |
| 沙箱 / 支付宝 / 微信适配器，含查单、关单、退款、账单下载 | `backend/src/payments/adapters/` | ✅ |
| 发起支付指定渠道、0 元单、配置版本固定到订单 | `payment-order.service.ts:94` | ✅ |
| 回调验签 → 收件箱 → 幂等入账 → 按渠道 ack | `payment-notification.service.ts` | ✅ |
| 15s worker：通知重试、超时关单、pending 查单、每日对账 | `payment-worker.service.ts` | ✅ |
| 关单前先查单，已支付立即入账 | `payment-order.service.ts:312` | ✅ |
| T+1 对账、查单二次确认、自动补发、7 类差异 | `payment-reconciliation.service.ts` | ✅ |
| 商品销售策略（不限量 / 周期 / 库存 / 限时）与库存占用 | `order.service.ts`、`Product` | ✅ |
| 后台订单列表 / 详情 / 查单 / 关单 / 导出 API | `payment-admin.controller.ts` | ✅ |
| 后台对账运行 / 列表 / 明细 / 导入 / 导出 API | `payment-admin.controller.ts:213` | ✅ |
| CSV BOM、公式注入防护、上海时区 | `common/csv.ts`、`payment-query.ts` | ✅ |
| 币种字段与后台默认币种设置 | `payment.defaultCurrency` | ⚠️ 仅后台，C 端未暴露 |

### 25.3 P0：当前可用性缺口

1. **后台 `/admin/payments` 四标签页缺失** ✅ 已落地（2026-11-02）
   - 参考：`web/src/pages/admin/payments/payments-page.tsx`（渠道 / 商品 / 订单 / 对账）。
   - 落地：`frontend/src/pages/admin/payments/` 下 `AdminPaymentsPage.tsx` + 四个 Tab
     （`PaymentsProvidersTab` / `PaymentsProductsTab` / `PaymentsOrdersTab` /
     `PaymentsReconciliationTab`），配套 `paymentStatusMeta.ts` / `paymentProductMeta.ts`；
     类型在 `frontend/src/types/payment.ts`。
   - 旧路由 `/admin/payment-channels` / `/admin/reconciliation` 已改为
     `Navigate` 重定向到 `/admin/payments?tab=providers` / `?tab=reconciliation`；
     侧栏「财务」组合并为「支付充值」（`adminNav.ts`）。
   - 旧页面 `AdminPaymentChannelsPage.tsx` / `AdminReconciliationPage.tsx` 与
     `src/types/api.d.ts` 里的旧类型（`AdminPaymentChannelStatus` /
     `ReconciliationBatch` / `ReconciliationItem` / `AdminPaymentRow`）已删除。
   - 值班带的对账计数改读新模型的 `failed` 运行数（旧的 `imported` 状态不存在了）。
2. **C 端不能选择支付方式**
   - 参考：`workspace-wallet-topup.tsx` 的商品卡 + provider 单选。
   - 现状：`CheckoutPaymentMethodCard.tsx` 是写死的单选项；`checkout/page.tsx:326` 调用 `paymentsApi.intent(o.id)` 不传 `providerId`。
   - 后果：同时启用支付宝与微信后，后端返回 `400 存在多个可用支付渠道，请指定 providerId`，结算页直接失败。
   - 需要：补 `paymentsApi.providers()`、渠道单选、`intent(orderId, providerId)`。
3. **支付结果动作不完整**
   - 参考：下单弹层支持「我已完成支付」「关闭订单」「重新生成支付入口」，支付宝返回 `/wallet?paymentOrder=...` 后自动恢复订单。
   - 现状：统一回 `/orders`，只做 30 秒轮询；没有主动重试收银台、没有结果弹层恢复。
4. **后台前端 API 客户端与类型未跟进** ✅ 已落地（2026-11-02）
   - `frontend/src/lib/api.ts` 现为四组：`adminPaymentProvidersApi` /
     `adminPaymentProductsApi` / `adminPaymentOrdersApi` /
     `adminPaymentReconciliationApi`，路径与后端一致。
   - `frontend/src/types/payment.ts` 承载支付域契约（provider 视图、商品视图、
     订单行 / 详情、对账运行 / 明细、显示状态与结果文案映射）。

### 25.4 P1：功能与可靠性差距

| # | 差距 | 参考实现 | 本仓库现状 / 待办 |
| --- | --- | --- | --- |
| 1 | 存储空间商品 | `TopupProductKind = credits \| storage` + `UserStorageGrant` | `Product.kind` 字段存在，但后台 `normalizeProductInput()` 强制 `credits`，订单创建也拒绝非 credits；无存储发放模型 |
| 2 | C 端支付设置 | `GET /payments/settings` | ✅ 已提供公开的 `GET /payments/settings`（默认币种 + 可用渠道） |
| 3 | 未支付订单上限 | 每用户 5 笔 active | ✅ 已限制每用户 5 笔 pending（2026-11-02） |
| 4 | 导出超限 | 超过 10000 行报错 | ✅ 支付订单 / 对账运行 / 对账明细均改为超限报错（2026-11-02） |
| 5 | 渠道公网地址 | 每个 provider 配置 `publicBaseUrl` 并校验 | ✅ 已支持按渠道配置 `publicBaseUrl`，未配置时回落 `PAYMENT_NOTIFY_BASE`（2026-11-02） |
| 6 | 查单 `not_found` 语义 | 只记录渠道状态，不直接关单 | ✅ 查单路径不再按 `not_found` 本地关单；只有关单路径确认后才关闭 |
| 7 | 关单失败二次查单 | 关单失败后再查一次，防止支付竞态漏单 | ✅ 查单/关单失败保留 pending 并释放租约，不再本地关单；下一轮 worker 会重试 |
| 8 | 邀请返佣 | 积分充值入账后 `grantReferralCommission()` | 无对应逻辑 |
| 9 | 商品后台校验 | 类型、金额上限、库存、周期、限时、描述长度全套 | ✅ 已补金额上限、库存必须 >0、周期/限时、划线价、积分与有效期上限；描述长度由 DTO 限制 |
| 10 | 插件级启停 | `pluginEnabled` 与 `configEnabled` 分离 | 只有配置启用 |
| 11 | 后端测试 | 25+ 个支付相关 Go 测试 | ✅ Vitest L1.6（57 条：payment-query / payment-order.close + notifyUrl / HTTP 集成含并发 / csv / zip-reader）+ `smoke-payments.js` 82 项；更细的多实例 spec 仍待补 |

### 25.5 P2：架构级差距（需产品决策）

| # | 差距 | 说明 |
| --- | --- | --- |
| 1 | 支付插件运行时 | 参考为插件包 + manifest + RPC runtime + 版本缓存 + 活跃订单阻塞升级/卸载；本仓库是编译期内置适配器 |
| 2 | 聚合支付渠道 | 参考有 `xunhupay / zhifufm / epay`；本仓库只有 sandbox/alipay/wechat |
| 3 | 对账并发抢占 | 参考单行 + 行锁 + 30 分钟冷却；本仓库「先查 running 再创建 attempt」并发下可能撞唯一键 |

### 25.6 不照搬的差异

- **不新建 `PaymentOrder` / `TopupProduct` 表**：复用 `Order` / `Product`，避免打断优惠券、会员、退款、发票、积分回收链路（D1）。
- **不引入微积分**：本仓库积分为整数，参考实现 `creditsMicrocredits` 不适用（D6）。
- **不引入 antd**：后台继续用 shadcn / `admin-ui`（D10）。
- **插件运行时不是当前阻塞项**：只接支付宝/微信时内置适配器足够；接聚合支付或插件市场时再立项。

### 25.7 建议实施顺序

1. **P0-1**：后台 `/admin/payments` 四标签页 + 旧路由重定向 + API 客户端 / 类型补齐 —— ✅ 已完成 2026-11-02。
2. **P0-2**：C 端 provider 列表、支付方式单选、`providerId` 透传、结果动作与返回恢复。
3. **P1**：存储商品、`GET /payments/settings`、active 订单上限、导出超限报错、`publicBaseUrl`、`not_found` / 关单二次查单、返佣、商品校验。
4. **P1-测试**：按参考实现补后端 spec，至少覆盖幂等入账、金额/币种不一致、交易号唯一、配置版本、周期限购、库存并发、对账补发与导出快照。
5. **P2**：再评估插件运行时、聚合渠道、对账并发抢占。

### 25.8 当前验证结果（基线 commit 505319c）

- `backend`：`npx tsc --noEmit` 通过；`npx prisma validate` 通过。
- `frontend`：`npx tsc --noEmit` 通过；checkout + channelOrder 测试 9 条通过。
- `backend` 支付域无 spec；`scripts/smoke-payments.js` 未覆盖新后台支付接口，需在 P0 完成后同步更新。

### 25.9 验证结果（2026-11-02，P0-1 完成后）

- `frontend`：`npx tsc --noEmit` 通过；`npm test` 41 文件 / 203 条通过。
- `frontend`：`npx playwright test --config=playwright.admin.config.ts` 全绿
  （含新增 `tests/admin-payments.spec.ts` 8 条：标签切换 / 深链 / 旧路由重定向 /
  三适配器渲染 / 无退款入口 / 对账执行区 / 状态深链回显）。
- `frontend`：`node scripts/sweep-admin.mjs` 35 条后台路由全部渲染，控制台零错误
  （`payments` 已加入 `ROUTES`）。
- `backend` 支付域仍无 spec，`scripts/smoke-payments.js` 仍测旧路径 —— 缺口未消。

### 25.10 复核修复结果（2026-11-02 第二轮）

本轮按支付链路复核结论修复了以下问题：

- **超时关单统一入口**：删除 `OrderService.cancelExpired()` 的直接改状态；旧调度器与支付 worker 都改走 `PaymentOrderService.closeExpired()`，先逐渠道查单，失败保留 pending。
- **关单失败不再本地误关**：查单异常、`closeOrder` 返回失败、渠道金额/交易号缺失时均保留 pending 并释放关单租约。
- **跨渠道尝试**：`query/close` 遍历订单全部 `Payment` 尝试；回调可匹配任意一次尝试的配置版本；`markPaid` 用 `status='pending'` 条件更新抢占，并记录实际成功渠道。
- **退款幂等**：查在途与建退款单同事务；同金额失败重试复用原 `outRefundNo`；退款渠道改用实际成功支付的 `Payment.channel/providerConfigId`。
- **0 元单退款**：`channel='free'` 的成功流水不再回落到原价，退款上限为 0。
- **支付宝账单**：支持 ZIP（stored/deflate）与 GB18030，表头前说明行可跳过；手工导入支持支付宝 `.zip`。新增 `common/archive/zip-reader.ts`。
- **对账运行回收**：超过 30 分钟的 `running` 运行自动标记 failed，worker 与手动重跑前都会回收。
- **支付宝响应验签**：交易类接口缺签名直接拒绝，不再 fail-open。
- **后台商品保存**：补 `kind` 必填字段；限时商品时间按本地时区正确回显与提交。
- **未支付订单上限**：每用户最多 5 笔 pending；超限返回 400，避免长期占库存。
- **导出超限报错**：支付订单 / 对账运行 / 对账明细超过 10000 行直接报错，不再静默截断。
- **对账默认日期**：前端按上海时区取昨天，避免东八区凌晨默认成前天。
- **CSV 下载响应**：中文文件名改用 RFC 5987（`filename*=UTF-8''…`），修复导出接口因非 ASCII 头直接 500 的问题。
- **C 端支付设置**：新增公开 `GET /payments/settings`（默认币种 + 可用渠道），前端 `paymentsApi.settings()` 已接入。
- **后台对账导入**：`/admin/payments?tab=reconciliation` 新增 CSV/ZIP 导入入口，支付宝支持 ZIP。
- **渠道公网地址**：支付宝/微信配置新增 `publicBaseUrl`（HTTPS；开发可 localhost HTTP），回调地址优先使用该渠道值，未配置回落 `PAYMENT_NOTIFY_BASE`。
- **商品校验**：补金额上限、划线价不得低于售价、库存商品必须 >0、周期/限时/积分/有效期/排序边界；前端同步校验与提示。

验证：

- `backend`：`npx tsc --noEmit`、`npm run build` 通过。
- `backend`：`npm test`（Vitest L1.6）**57 条通过**：`payment-query`、`payment-order.close`（查单/关单失败不本地关单、多渠道尝试、`publicBaseUrl` 优先级）、`payments.integration`（临时 SQLite + 真实 Nest HTTP：回调/幂等/并发入账/关单/退款/并发退款/库存并发/0 元/订单上限/权限/DTO/CSV 导出）、`csv`、`zip-reader`。
- `backend`：新增 `npm run verify:payment-bills`（6 项：ZIP stored/deflate、直接 CSV、GB18030、路径穿越、缺少 CSV）通过。
- `backend`：`scripts/smoke-payments.js` 已重写为新接口，并在开发档跑通 **82 项 / 0 失败**（渠道列表、C 端设置、intent、回调入账/幂等、金额不符、未知单、关单、全额/部分退款、并发回调只入账一次、周期限购、库存并发不超卖、未支付订单上限、0 元单不可退、后台渠道/商品/订单、CSV 导出、对账导入与超时运行回收）。
- `backend`：`npm run verify:payment-signatures` 已按新适配器重写并跑通 **25 项 / 0 失败**（支付宝 RSA2 回调/响应签名、微信 v3 验签+AES-GCM 解密/防重放、回调公网地址校验、沙箱生产环境拒绝）。
- `frontend`：`npx tsc --noEmit` 通过；`npm test` 42 文件 / 220 条通过。

仍缺：后端支付域仍需更细的单元/集成 spec（并发库存、周期限购、对账自动补发等边界），当前由 smoke 覆盖主链路。
