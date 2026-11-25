# 支付域重构设计

> 状态：**主体已实施**。后端支付域主链路、后台 `/admin/payments` 三标签页（收款设置 / 交易核对 / 异常处理）与 C 端支付方式选择均已落地；存储扩容商品、支付插件运行时与部分可靠性项仍未实施，见 §13。
> 参考实现：`open-ai-canvas/backend/internal/app/payment*.go`、`backend/internal/repository/payment.go`、`open-ai-canvas/web/src/pages/admin/payments/payments-page.tsx`。
> 拆分后的配套文档：后端实现规格见 [`payment-detailed-design.md`](payment-detailed-design.md)，后台与 C 端实现规格见 [`payment-ui-design.md`](design/admin/payment-ui-design.md)。
> 本文只写目标、决策、规则与现状差距；与代码冲突时以代码为准。

## 0. 结论与已定决策

先把会影响实现的决策定下来，避免开发阶段反复改表：

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **不新建 `PaymentOrder` 表**，复用 `Order` + `Payment`，在 `Order` 上补支付编排字段 | 本仓库的 `Order` 已承载优惠券、活动、会员、退款、发票、积分回收，另建支付订单会复制这整条资金链路，并让退款出现两套入口 |
| D2 | 支付渠道配置**加密落库、不可变版本化**；订单固定 `providerConfigId + version`；回调 URL 带 `configId` | 换密钥后旧订单的回调仍必须能验签；参考实现正是把 configId 放进 notify URL |
| D3 | 渠道白名单由**适配器注册表**定义，不读环境变量；缺字段一律 503，不降级沙箱 | 与现有 `PaymentProviderFactory` 的安全铁律一致，但把配置来源从 env 换成版本化配置 |
| D4 | 新增权限点 `payment.write`（渠道配置，高危）与 `payment.operate`（查单/关单）；`payment.read` 继续读；对账沿用 `finance.reconcile` | 与现有权限矩阵对齐：财务可改钱，运营只读排障 |
| D5 | 新增 `/admin/payments` 支付工作台（最终收口为 收款设置 / 交易核对 / 异常处理 三标签）；商品与订单不入本页，分别沿用 `/admin/products`、`/admin/orders`；`/admin/payment-channels`、`/admin/reconciliation` 改为重定向 | 同一份渠道/对账数据不保留两套入口；商品与订单各有自己的页，混排会让字段集与动作分叉；旧书签与告警深链不 404 |
| D6 | 积分为**整数**（复用 `Product.credits`），不引入微积分；币种默认 CNY，USD 仅在存在声明支持 USD 的渠道时允许上架 | 本仓库积分域与结算全是整数；没有 USD 通道时放开 USD 等于卖不出去的商品 |
| D7 | 存储扩容商品（`kind=storage`）**不进本轮**；商品页保留该选项但禁用并说明原因 | 本仓库没有存储配额与上传容量校验，先做会变成「卖了容量但不限流」的假功能 |
| D8 | 支付通知收件箱 + **独立 15s worker**；不复用 10 分钟一次的 `SchedulerService.tick()` | 现有调度间隔是 10 分钟（`scheduler.service.ts:11`），用它消费回调会把「已付款」晾十分钟 |
| D9 | 对账新建 `PaymentReconciliationRun/Item`，旧 `ReconciliationBatch/Item` 停止写入 | 新模型需要「每个渠道每天一次运行、自动补发、失败原因」；旧模型是人工导入批次，语义不同 |
| D10 | 后台页面使用本仓库 shadcn + `admin-ui` 原语，**不引入 旧版 UI 库** | 后台 32 页已统一为 shadcn；参考页的 旧版 UI 库组件只作为交互参照，不照搬实现 |

> 原待定的两项已裁定，结论见 §12。

---

## 1. 目标与非目标

### 1.1 目标

1. **多渠道并存**：沙箱、支付宝、微信可同时启用；用户在结算页选择支付方式。
2. **渠道配置可运营**：后台维护密钥、网关、回调基址；密文落库、版本化；历史订单固定使用下单时的版本。
3. **订单可运维**：后台查单、关单；关单前先查单，渠道已支付则立即入账，避免「钱收了、单还挂着」。
4. **回调可靠**：验签后先落持久化收件箱，再异步入账；重复回调、进程重启、短暂数据库故障都不丢单。
5. **T+1 对账闭环**：按渠道下载账单，逐笔比对；已支付未入账的订单经签名查单二次确认后自动补发；其余差异留痕。
6. **页面完整复刻**：`/admin/payments` 支付工作台的标签、表格列、抽屉、筛选、分页、导出、空/错/加载态与参考页对齐；交互改用本仓库组件语言。

### 1.2 非目标

| 项 | 原因 |
| --- | --- |
| 存储空间扩容商品 | 缺配额模型；Phase 5 与存储配额子系统一起做 |
| 易支付 / 虎皮椒 / 支付FM 等聚合通道 | 每家的下单、验签、查单、账单协议都不同；先把支付宝/微信打通，再按 `PaymentAdapter` 扩展 |
| 重写退款 | 现有 `OrderService.refund()` 已是「先落退款单、再调渠道、成功才动本地账」；本次只把渠道配置来源换成版本化配置，并把配置版本固定到退款 |
| 会员套餐并入充值商品 | 会员是周期权益，留在 `/admin/membership-plans` |
| 发票域 | 独立模块，不随支付重构调整 |

---

## 2. 立项基线

立项时（2026-10-31）的支付域只有：单一启用通道（`PAYMENT_PROVIDER` + 环境变量）、回调同步入账、超时直接本地取消、对账靠人工上传 CSV、商品只有价格与积分、后台仅「只读渠道状态 + 人工对账」两页。凭据改动必须改环境变量并重启，同一时间只能有一个通道，C 端无法选择支付方式。

以上已按本方案改造：渠道配置改为加密版本化配置、回调先落收件箱再异步入账、关单前先查单、对账支持账单下载与自动补发、商品补币种与销售策略、后台收口为支付工作台。当前实现见 [`payment-detailed-design.md`](payment-detailed-design.md) 与 [`payment-ui-design.md`](design/admin/payment-ui-design.md)。

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
| 回调 | `/api/payments/notify/:provider/:configId` | `/api/v1/payment/webhook/:channel` | 固定 URL 由订单历史 Payment 反查下单时的配置版本；旧带 `configId` 路由保留兼容 |
| 后端 worker | 15s 独立循环 | 15s `PaymentWorkerService` | 不用 10 分钟的调度器 |
| 对账 | `PaymentReconciliationRun/Item` | 同名新表，替换旧批次表 | 旧表只读保留一个版本周期 |
| 后台 UI | 旧版 UI 库 + 自定义 admin-ui | shadcn + `admin-ui` | 视觉语言按本仓库，不引 旧版 UI 库 |
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
4. `version = max(version) + 1`。
5. 读取时解密，只回传非密钥字段；密钥字段回 `secretConfigured: true` 与掩码，**永不回传明文**。

`SecretCipher` 从 `model/infra/` 抽到 `common/security/`，做成全局模块；`ModelModule` 继续 re-export，模型域调用点不改。`MODEL_SECRET_KEY` 语义不变：模型与支付凭证共用该密钥，轮换会使两者密文同时失效（写进 `backend/.env.example` 与 NOTICE）。

### 4.4 订单与支付尝试

不新建 `PaymentOrder`。在 `Order` 上补支付编排字段，在 `Payment` 上补配置版本与关单信息。

- 一个订单同一时刻只有一个进行中的支付意图；再次发起时先关闭旧的 pending 尝试。
- 发起支付用 `Order.intentStartedAt` 做全过程租约（关闭旧尝试 → 渠道下单 → 写回本地）。租约过期可被新请求接管，旧请求写回时必须同时匹配租约值；匹配失败则关闭刚创建的渠道单并返回 409，禁止覆盖新 checkout。
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

规范回调路径为 `GET/POST /api/v1/payment/webhook/easypay`、`POST /api/v1/payment/webhook/{alipay,wxpay,stripe}`。URL **不携带 `configId`**。PayPal / ZPay 没有规范回调入口，`notifyUrl()` 直接拒绝发起支付；接入前需先补对应 webhook 路由。

1. EasyPay / 支付宝 / Stripe 从明文商户订单号定位订单；Stripe 以 PaymentIntent id 为主（历史 Checkout Session id 仅兼容旧单），EasyPay 用渠道订单号定位历史 Payment。微信通知正文加密，先用所有历史配置的 APIv3 密钥尝试解密，唯一得到商户订单号后再按历史配置验签。
2. 从这些 Payment 收集 `providerConfigId`，逐个加载下单时的配置版本；订单不存在或没有任何历史支付尝试 → 失败响应，验签前拒绝。
3. 适配器用历史 `values` 验签；多个配置同时验签通过时，必须由 `providerTradeNo` 唯一命中一条历史 Payment，否则拒绝处理。绝不回落到渠道最新配置。
4. 归一出 `merchantOrderNo / providerTradeNo / amountCents / currency / paid / closed / paidAt / providerStatus / eventId`。
5. 金额/币种不符 → 落 `PaymentNotification(status='failed')` + 对账差异，回渠道成功以停止无意义重试。
6. 以 `(providerId, eventId)` 唯一写入 `PaymentNotification`（原始报文加密、摘要落库）。重复事件直接回成功。
7. 立即尝试处理；失败保留 `pending`，worker 按指数退避重试。
8. 应答格式由适配器 `ack()` 决定（支付宝纯文本 / 微信 JSON）。

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


---

## 5. C 端支付流程

### 5.1 结算页 `CheckoutPage.tsx`

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

### 5.2 商品页 `PackagesPage.tsx`

- 商品卡展示币种、售罄/待发售/已结束/限时。
- 不可购买时禁用按钮并给出原因（库存不足 / 未到发售时间 / 周期次数已用完 / 已下架）。
- 不展示 USD 商品，除非存在可用 USD 渠道；否则商品卡显示「暂无可用的美元支付渠道」。

### 5.3 订单页 `pages/orders/`

- 「继续支付」跳到结算页并携带 `orderId`；渠道不可用时提示重新选择。
- 状态文案补「关单中」「下单失败」「已退款」「部分退款」。

---


---

## 6. 关键规则

### 6.1 幂等

- 下单：`@@unique([userId, idempotencyKey])` 不变。
- 回调：`Payment.payTransactionId` 唯一；`PaymentNotification(providerId, eventId)` 唯一。
- 入账：`markPaid()` 先查交易号、再判订单状态；重复通知不重复发积分。
- 对账补发：同一 `(runId, merchantOrderNo)` 唯一；补发仍走 `markPaid()`，天然幂等。
- 关单：`closeStartedAt` 先抢占，避免 worker 与人工同时关单。

### 6.2 金额与币种

- 订单金额以 `Order.paidCents` 快照为准；回调金额必须相等，币种必须相等。
- 商品币种来自 `Product.currency`；订单落 `Order.currency`；`Payment.currency` 同值。
- 渠道 `supportedCurrencies` 不含订单币种时，下单前拒绝（`400`），不把美元单发给只收人民币的通道。

### 6.3 查单与关单

关单顺序不可反：

1. 向渠道查单。
2. 已支付 → 走 `applyPaymentResult` 入账；已关闭 → 本地关闭；未支付 → 调渠道关单。
3. 关单失败后再查一次：支付可能恰好在查单与关单之间完成。
4. 两次都查不到且渠道返回「订单不存在」→ 本地关闭。
5. 其他失败 → 保持 `pending`，写 `lastError`，由 worker 重试；**不本地关闭**。

过期订单同理：先查单再关单，不直接 `cancelled`。

### 6.4 对账补发

- 渠道账单中出现但本地未入账的订单，必须先 `queryOrder()` 确认 `paid=true`、金额/币种/交易号一致，再调用 `markPaid()`。
- 确认失败 → `credit_failed`，不补发。
- 补发失败 → `credit_failed`，保留明细，人工重试。
- 对账只改对账状态，不改订单/积分；补发是调用订单入账路径，不是直接写积分。

### 6.5 商品上架

- `unlimited`：默认可购买。
- `periodic`：按 `(userId, productId, createdAt)` 统计周期内已支付订单数，达到 `periodPurchaseLimit` 拒绝。
- `inventory`：下单时条件更新 `stockReserved += 1`（不超过 `stockTotal - stockSold`）；支付成功 `stockReserved -= 1, stockSold += 1`；取消/超时 `stockReserved -= 1`。
- `timed`：`now` 必须落在 `[saleStartAt, saleEndAt]`；未开始显示「待发售」，结束显示「已结束」。
- 商品下架不影响历史订单与已发积分。

### 6.6 安全

- 渠道密钥只以密文落库；接口永不回传明文；日志不打印密钥。
- 公开回调不挂 JWT，只信验签；原始报文必须用 `rawBody`。
- 后台权限校验必须在后端；前端 `can()` 只隐藏按钮。
- 生产环境沙箱通道强制不可用：即使配置启用，`availableProviders()` 也过滤。
- 回调 URL 必须带 `configId`，否则换密钥后旧订单无法验签。

---

## 7. 迁移与兼容

### 7.1 数据库

- 结构变更走 Prisma Migrate：schema 改动后生成 `prisma/migrations/<ts>_<name>`，各环境 `prisma migrate deploy`。本方案初稿写于 `db push` 时期，2026-11-24 起仓库已建立 baseline 迁移，旧库按 [`docker-deployment.md`](docker-deployment.md) §4 标记基线后 deploy。
- 新表与新增字段全部可空/有默认值；旧数据无需回填。
- 旧 `ReconciliationBatch/Item` 保留只读，Phase 3 完成后标注 deprecated，下一轮再删除。
- 旧 `Order.channel` 值保持 `sandbox / alipay / wechat`；不新增 `providerId`。

### 7.2 环境变量

- `PAYMENT_PROVIDER` 保留为**首次启动的引导值**：若数据库没有任何 `PaymentProviderConfig`，启动时按该值生成 v1 配置（凭据从 env 读取一次），之后以数据库为准。
- `ALIPAY_*` / `WECHAT_*` 保留为引导凭据；后台保存后不再读取。
- `PAYMENT_NOTIFY_BASE` 保留（回调基址），配置页可展示但不在界面修改（避免把回调地址改到不可达域名）。
- `backend/.env.example` 与 `docs/environments.md` 注明：引导完成后以数据库配置为准；`MODEL_SECRET_KEY` 同时保护模型与支付凭证。

### 7.3 前端路由

- 新增 `/admin/payments` 支付工作台（收款设置 / 交易核对 / 异常处理三标签）。
- `/admin/payment-channels` → `/admin/payments?tab=providers`；`/admin/reconciliation` → `/admin/payments?tab=reconciliation`。
- `adminNav.ts`「资金与财务」组：收款设置 / 交易核对 / 异常处理三个入口（均 `payment.read`），另有支付与退费、发票管理、生成账单、财务分析；旧的两个入口已移除。
- 告警中心、值班带、后台搜索中的旧链接同步改到新地址。

---

## 8. 实施批次（已执行）

原计划分 Phase 0–5 推进，实际落地情况：

- **Phase 0–4 已完成**：基础设施（SecretCipher、适配器注册表、支付配置服务）、渠道配置与支付工作台、支付订单与 15s worker、对账（账单下载、自动补发）、商品增强（币种 / 策略 / 库存 / 限时）与页面收口。
- **Phase 5 未做**：存储扩容商品与聚合渠道的剩余部分（易支付 / ZPay / PayPal / Stripe 适配器已落地，见 §13.2）。

后续批次不再维护在本节；未完成项统一记在 §13。

---


## 9. 测试计划

### 9.1 单元

- 配置加密/解密；密钥字段留空沿用旧值；版本自增；掩码不回显。
- 金额/币种核对；重复回调幂等；订单状态机不可跳跃；`payTransactionId` 去重。
- 关单顺序：查单已支付 → 入账；查单未支付 → 关单；关单失败 → 再查一次。
- 商品上架策略：周期次数、库存占用/释放、限时窗口。
- 对账：`matched / recovered / amount_mismatch / trade_no_mismatch / credit_failed / local_order_not_found / provider_record_missing`。
- 对账补发必须经过签名查单；查单未确认不补发。
- 回调 configId 不匹配、验签失败、金额不符、订单不存在。
- 展示状态派生与 Prisma where 映射、排序白名单、分页越界、导出截断与关键字匹配（见 [`payment-ui-design.md`](design/admin/payment-ui-design.md) §4.9）。

### 9.2 集成

- 本地 mock 渠道服务：支付宝 RSA2 表单、微信 v3 签名与 AES-GCM 回调解密。
- 回调重复、乱序、验签失败、金额不符、订单不存在。
- 收件箱重试：第一次入账失败后 worker 重试成功；重复事件不重复发积分。
- 进程重启后 pending 通知仍能入账。
- 数据库短暂不可用时回调不丢（收件箱落库失败则回渠道失败，渠道重试）。
- 配置版本固定：保存 v2 后，v1 订单的回调仍用 v1 验签与查单。

### 9.3 前端

- `/admin/payments` 三标签渲染、`?tab=` 同步、刷新按钮。
- 渠道配置抽屉：动态字段、密钥占位、保存新版本、无权限隐藏保存。
- 商品新建/编辑、库存不足提示、限时状态；无 USD 渠道时 USD 商品只能存为 `offline`，上架被拒绝。
- 订单筛选/分页/导出/详情/查单/关单。
- 对账执行、运行列表、明细筛选、导出、失败原因。
- 五态：空/loading/有数据/失败/无权限。
- 无 `payment.write` 不显示保存；无 `finance.reconcile` 不显示执行对账（后端仍校验）。

### 9.4 闸口

```bash
cd backend && npm run build
cd frontend && npm run typecheck && npm run build
cd frontend && npx vitest run
node backend/scripts/smoke-payments.js
npm run check
```

真实渠道（支付宝/微信）的查单、关单、账单下载必须用商户号实跑一次；此前只能声明「代码按官方规格实现，mock 契约已覆盖」。

---

## 10. 风险与取舍

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 凭据从 env 迁到数据库 | 部署方式变化；首次启动无渠道可用 | 启动引导 env → v1 配置；无配置时页面显式告警；生产门禁提示至少配置一个渠道 |
| 加密密钥丢失 | 所有渠道配置不可解密 | 与数据库同备份；轮换需重新录入；日志不打印密钥 |
| SQLite 并发 | 库存占用、收件箱抢任务冲突 | 事务 + 条件更新 + 唯一约束；单机 worker 串行 |
| 支付宝账单 ZIP | 解析失败或引入新依赖 | 复用 `common/archive/zip-reader.ts`，不引新依赖（§12） |
| 旧页面/链接下线 | 书签、告警深链 404 | 旧路由重定向；告警与值班带链接同步修改 |
| 订单派生状态 | 与旧订单页文案不一致 | 状态映射集中在 `paymentStatusMeta.ts`；旧订单页补文案 |
| 10 分钟调度器 | 回调入账延迟 | 独立 15s worker；不依赖 `SchedulerService.tick()` |
| 回调 configId | 旧订单回调 404 | 通知 URL 下单时生成；保留一版旧路由（按当前配置）用于在途订单 |
| 存储商品缺配额 | 卖了容量但不限流 | 本轮不做；Phase 5 与配额子系统一起上线 |
| USD 无通道 | 商品卖不出去 | 后端按 `supportedCurrencies` 拒绝上架/支付；前端禁用并说明 |

---

## 11. 验收标准

已落地项：

- [x] `/admin/payments` 与参考页的信息架构、列、抽屉、筛选、分页、导出一致；使用 shadcn，无旧版 UI 库新引用。
- [x] 渠道配置可保存新版本；密钥不回显；历史订单固定版本；回调携带配置版本。
- [x] 多渠道同时可用；C 端可选择支付方式；缺凭据 503，不降级沙箱；生产过滤沙箱。
- [x] 查单 / 关单顺序正确；关单前已支付会入账；失败保持 pending 并可重试。
- [x] 回调重复不重复发积分；进程重启后 pending 通知仍能入账。
- [x] 对账可按渠道 / 日期执行；自动补发前有签名查单确认；差异可筛选 / 导出；失败原因可见。
- [x] 商品支持币种、上架策略、库存、限时；下单 / 取消正确占用与释放库存。
- [x] 退款仍走订单管理，渠道配置使用订单固定版本；支付页不提供退款按钮。
- [x] 旧 `/admin/payment-channels`、`/admin/reconciliation` 重定向；告警深链不 404。

仍未验：

- [ ] 真实渠道（支付宝 / 微信）的查单、关单、账单下载需用商户号实跑一次并留证据；当前只有签名与契约级覆盖。

## 12. 评审结论

| 项 | 结论 |
| --- | --- |
| USD 商品 | 字段与校验保留，但没有支持 USD 的渠道时前后端都拒绝上架 / 支付 |
| 支付宝 ZIP | 不引入 `fflate`，复用 `common/archive/zip-reader.ts`（stored / deflate + GB18030） |
| 旧对账数据 | 新页面不展示旧 `ReconciliationBatch`；旧页重定向，旧数据留在库中按需导出 |
| 支付页会员订单 | 不展示；会员订单留在 `/admin/orders`，避免「商品」列口径混淆 |

---

## 13. 当前状态与开放差距

> 与代码冲突时以代码为准；后端契约见 [`payment-detailed-design.md`](payment-detailed-design.md)，后台与 C 端实现见 [`payment-ui-design.md`](design/admin/payment-ui-design.md)。

### 13.1 已落地

- **后端支付域主链路**：渠道配置加密版本化、适配器（沙箱 / 支付宝 / 微信 / 易支付 / ZPay / PayPal / Stripe）含查单、关单、退款与账单下载，发起支付、查单 / 关单、回调收件箱 + 15s worker、T+1 对账与自动补发、后台支付 API。
- **后台 `/admin/payments` 支付工作台**：收款设置 / 交易核对 / 异常处理三标签，侧栏三个入口；旧 `/admin/payment-channels`、`/admin/reconciliation` 重定向到对应标签。
- **C 端结算**：`GET /payments/settings`（默认币种 + 可见支付方式）、`paymentsApi.providers()` 与 `intent(orderId, providerId)`、支付方式单选、跳转 / 二维码 / 沙箱 / 0 元单、轮询与续付、结果卡「我已完成支付 / 重新打开收银台」。
- **支付域测试**：Vitest L1.6（`payment-query`、`payment-order.close`、`payments.integration`、`csv`、`zip-reader` 等）、`smoke-payments.js`、`verify:payment-signatures`、`verify:payment-bills`。

### 13.2 开放差距

| # | 差距 | 本仓库现状 | 处置 |
| --- | --- | --- | --- |
| 1 | 存储扩容商品 | `Product.kind` 存在但只支持 `credits`；无存储发放与容量校验模型 | 与存储配额子系统一起立项 |
| 2 | 邀请返佣 | 积分充值入账后无 `grantReferralCommission()` 相当逻辑 | 待产品决策 |
| 3 | 插件级启停 | 只有配置启用，没有 `pluginEnabled` 与 `configEnabled` 分离 | 接插件市场时再立项 |
| 4 | 支付插件运行时 | 本仓库是编译期内置适配器，参考实现为插件包 + manifest + RPC runtime | 非当前阻塞项 |
| 5 | 对账并发抢占 | 参考实现用单行 + 行锁 + 30 分钟冷却，本仓库「先查 running 再创建 attempt」并发下可能撞唯一键 | 待加固 |
| 6 | 币种 C 端暴露 | 币种字段与后台默认币种已落，C 端未暴露多币种选择 | 待产品决策 |

### 13.3 不照搬的差异

- **不新建 `PaymentOrder` / `TopupProduct` 表**：复用 `Order` / `Product`，避免打断优惠券、会员、退款、发票、积分回收链路（D1）。
- **不引入微积分**：本仓库积分为整数，参考实现 `creditsMicrocredits` 不适用（D6）。
- **不引入旧版 UI 库**：后台继续用 shadcn / `admin-ui`（D10）。
- **本页不提供退款**：退款统一走订单管理；支付域只做查单、关单与对账。
