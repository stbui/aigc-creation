# 商业域设计（积分 / 商品 / 订单 / 支付 / 会员 / 营销）

交易的完整链路：卖什么（商品）、钱怎么收（订单 + 支付 + 退款）、收到什么（积分）、权益与增长（会员 / 营销 / 发票 / 对账）。后台页面见 `docs/admin-console-design.md` §3.9–3.10。

| 项 | 事实源 |
| --- | --- |
| 数据模型 | `backend/prisma/schema.prisma` |
| 积分扣减与退款 | `backend/src/credits/credit.service.ts` |
| 订单状态机与退款 | `backend/src/orders/order.service.ts` 的 `TRANSITIONS` |
| 支付通道 | `backend/src/payments/` |
| 商品与套餐 | `backend/src/products/` |
| 会员 | `backend/src/membership/` |
| 营销 | `backend/src/marketing/` |
| 发票 / 对账 | `backend/src/invoices/`、`backend/src/admin/reconciliation.service.ts` |
| 退款规则默认值 | `backend/src/admin/settings.dto.ts` 的 `SETTING_DEFS` |

---

## 1. 领域模型

```
Product (SKU) ──下单──> Order ──支付──> Payment ──回调──> 发积分
                          │                              │
                          │支付成功                        ↓
                          ↓                        CreditLot（批次，有到期日）
                    Membership                   CreditLedger（流水，只追加）
                          ↑                              │ 消耗 / 退还
                     会员权益                      GenerationTask（计费快照）
```

职责边界：

| 域 | 唯一职责 | 不负责 |
| --- | --- | --- |
| 商品 | 定义卖什么、卖多少、积分数量与有效期 | 不管钱 |
| 订单 | 一次购买的快照与状态推进 | 不直接改余额，只写流水 |
| 支付 | 与外部通道的协议适配、回调验签 | 不决定发多少积分 |
| 积分 | 余额的唯一裁决者（批次 + 流水） | 不碰订单状态 |
| 会员 | 有效期与月度积分 | 不决定订单是否可付 |

**核心约束：余额永远由批次与流水推导，代码里没有「直接改 balance 数字」的分支。** 金额一律整数分，禁止浮点。

## 2. 积分账本

### 2.1 两张表

| 模型 | 关键字段 | 说明 |
| --- | --- | --- |
| `CreditLot` | `userId / source / orderId? / totalCredits / remainingCredits / expireAt?` | 批次。`expireAt` 为空 = 永久有效 |
| `CreditLedger` | `userId / type / amount(有符号) / balanceAfter / lotId? / orderId? / taskId? / idempotencyKey? / reason? / operatorId?` | 流水，只追加，永不 UPDATE / DELETE |

`CreditLot.source`：`purchase` / `grant` / `admin_adjust`（会员月度发放、邀请奖励、签到都记 `grant`）。`CreditLedger.type`：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`。`idempotencyKey` 唯一，保证回调重放不重复发放。

### 2.2 扣减规则

- **FEFO**：先到期先扣，`expireAt` 为 `NULL` 视为最晚到期。
- 跨批次扣减，余额不足**整体回滚**并报 `40002`（前端按 402 语义处理）。
- 并发用条件更新 `updateMany({ where: { remainingCredits: { gte: cost } } })`，不引入行锁：自研 adapter 只支持 SERIALIZABLE，SQLite 本身单写者。
- 每次变动写 `balanceAfter`，流水可独立还原任意时刻余额。
- 人工增减必须填原因，落 `admin_adjust` 并写审计。

### 2.3 到期回收

调度任务 `credit-expire` 扫描到期批次：剩余积分写 `expire` 流水并清零批次。到期时间不因任何操作延长。

## 3. 商品

`Product`：`sku(唯一) / name / description / type / priceCents / originalPriceCents? / credits / creditsValidDays / grantType / status / sortOrder`。

- `priceCents` 整数分，`0` 表示免费发放；`originalPriceCents` 只用于展示划线价，不参与任何计算。
- `creditsValidDays`：`0` = 永久有效（FEFO 视为最晚）。
- `grantType`：`immediate`（支付成功即发）/ `manual`（后台手动发放）。
- `status`：`active` 上架 / `offline` 下架。下架不影响历史订单与已发积分。

**能力的单次消耗价不是商品的字段**：默认值在 `capabilities/definitions/<id>.ts` 的 `creditCost`，运行时一律经 `CreditPriceService.resolve()` 取生效价（后台覆盖价 / 限时活动优先）。业务代码直接读 `creditCost` 会让后台调价失效。

## 4. 订单

### 4.1 状态机

```ts
pending → paid | cancelled
paid → refunded | partial_refunded
partial_refunded → refunded | partial_refunded
```

未支付订单 **30 分钟**后由调度任务自动关闭（`ORDER_TTL_MINUTES`）。`cancelled` 与 `refunded` 是终态；已支付订单只能走退款，不能取消。

### 4.2 三条硬规则

1. **金额快照**：`OrderItem` 复制 `skuSnapshot / nameSnapshot / priceCentsSnapshot / creditsSnapshot / validDaysSnapshot`；`Order.totalCents / discountCents / paidCents` 在支付成功时定稿。商品改价不追溯历史订单。
2. **幂等下单**：`@@unique([userId, idempotencyKey])`，重复提交返回同一订单。
3. **退款上限按实付**：`paidCents = totalCents - discountCents`；上限用 `paidCents` 而非 `totalCents`，否则用券订单会多退。

`couponSnapshot` 保存当时的券或活动规则：券被改或删掉后，历史订单的优惠金额仍解释得清。

### 4.3 订单号

`orderNo` 唯一，供客服与对账人工比对；内部逻辑一律用 `id`。

## 5. 支付

### 5.1 三层

```
PaymentsService（编排）
  └── PaymentProvider（沙箱 / 支付宝 RSA2 / 微信 v3）
        └── node:crypto
```

由 `PAYMENT_PROVIDER` 决定生效通道（`sandbox` / `alipay` / `wechat`）。**凭据缺失返回 503 `50301`，绝不静默回落沙箱**；沙箱回调在生产档拒收。

### 5.2 回调三道闸

1. **验签**：支付宝 RSA2 响应必须验签，缺签或验签失败一律不给「成功」；微信 v3 用 AES-GCM 解密并校验签名。
2. **金额核对**：与订单 `paidCents` 不符则落对账差异、**不置 paid**、回执失败让渠道重试。
3. **幂等**：`payTransactionId @unique`，已处理过的交易号不重复发积分。

`ackSuccess` 与 `ok` 语义不同：非成功交易状态也回执成功，以停止渠道重试。

原始报文存 `Payment.rawPayload`：对账申诉时这是唯一能自证的凭据，只落库，不进审计与接口响应。

### 5.3 通道状态

`PaymentProviderFactory.status()` 与 `PaymentsService.notifyUrl()` 是后台「支付渠道」页的唯一数据源。三类静默故障（真实通道缺凭据、生产走沙箱、未配 `PAYMENT_NOTIFY_BASE`）在页面上显式告警。

## 6. 退款

### 6.1 校验顺序不可反

1. 硬约束：金额 ≤ 实付 − 已退（`40001`）。参数错误不能被伪装成规则拦截。
2. 可配规则（`SETTING_DEFS`）：
   - `refund.windowDays`（默认 7，`0` = 不限）→ 超时 `40905`
   - `refund.maxRatioBps`（默认 `10000` = 全额，按实付向下取整）→ 超出 `40906`
   - `refund.allowConsumedTask`（关闭后积分已消耗且扣不回即拒退）→ `40907`
3. 同一订单存在 `processing` 退款 → `40908`。

### 6.2 两段式

1. 校验通过后落 `Refund(status='processing')`，用它的 id 作渠道幂等键 `outRefundNo`。
2. 调渠道：失败置 `failed` 并抛 `50302`，**订单状态与积分都不变**，可用同一退款单重试。
3. 渠道成功才回收积分（`reclaimForOrder`）、迁移订单状态、累加 `refundedCents`。

微信返回 `PROCESSING` 时保持 `processing`，本地账不动，需人工到商户后台确认。`channel='manual'`（后台标记已支付）不调渠道。

**绝不允许「只改库、假装退过钱」。**

### 6.3 回收积分的两种缺口

`Refund.creditsReclaimed` 记录实际扣回数，`creditsUnreclaimable` 记录因已消耗而扣不回的数量。后者必须如实记录，否则对账会以为系统丢了积分。

会员单全额退款会终止会员周期（响应带 `membershipTerminated`）。

## 7. 会员

`MembershipPlan`（`code / priceCents / durationDays / monthlyCredits / perks / status`）→ `Membership`（`planId / perksSnapshot / monthlyCreditsSnapshot / startAt / expiresAt / status / nextCreditAt / orderId?`）。

- **激活唯一路径**：订单支付成功且 `membershipAppliedAt` 为空才激活。该字段与订单同生命周期——不能靠 `Membership.orderId` 判断，续费时它会指向最新一笔，旧订单重放即可白拿一期。
- 月度积分由调度任务 `membership` 按 `nextCreditAt` 发放，发放时生成新的 `CreditLot`。
- 到期失效同由该任务处理，失效前先查后更，以便给用户发站内消息。
- 取消自动续费后 `status='cancelled'`，已付周期保留至 `expiresAt`；续费可重新激活并顺延。
- 会员折扣与用量落 `MembershipUsage`（`orderId @unique`、`savedCents`），用于统计权益被用掉多少。

## 8. 营销

| 模块 | 模型 | 规则 |
| --- | --- | --- |
| 优惠券 | `Coupon` | `type` 满减/折扣/固定额；`thresholdCents` 门槛；`scope` + `productIds` 适用范围；`totalCount` / `usedCount` / `perUserLimit`；核销时写 `Order.couponId` 与 `couponSnapshot` |
| 限时活动 | `Campaign` | 类型 `limited_price` / `limited_free` / `popup`；`payload` + `startAt/endAt` + `audience`；进行中的免活动让 `CreditPriceService.resolve()` 返回 0，到期由调度任务收尾 |
| 邀请 | `InviteRelation` / `InviteRewardRule` | 被邀请人**首次付费**才触发奖励；奖励双方积分各自建批次 |
| 签到 | `CheckinRecord` / `CheckinRule` | 基础积分 + 连签加成，按日去重 |

公开的 `GET /marketing/campaigns` 只回**真正更便宜且在售**的活动，避免把「原价打九折后再涨」算成优惠。

## 9. 发票与对账

### 9.1 发票

一单一票（`orderId @unique`），金额取 `paidCents - refundedCents` 快照；输出可打印 HTML，零 PDF 依赖。开具与驳回必填原因并写审计。

### 9.2 对账

- CSV 手写 RFC4180 解析 + 表头别名；金额单位按表头是否含 `cent|分` 判定。
- 差异五类：`matched` / `amount_mismatch` / `missing_local` / `missing_channel` / `duplicate`。
- **处置只改状态与备注，不改钱**。处置权只给财务（`finance.reconcile`）。

## 10. 生成扣费与退款

| 阶段 | 行为 |
| --- | --- |
| 创建任务 | 取生效价 → 扣积分 → 建任务并写 `task.creditCost` 快照 |
| 扣费与建任务 | **不能同事务**，故失败退款是对该代价的兜底 |
| 任务失败 / 取消 | 按任务快照**原额退还**，不重新取价 |
| 退款成功 | 写 `refund_reclaim` 类流水，并给用户发站内消息（仅退款真的成功时） |

无可用模型线路、遮罩不受支持等情况都在**扣费之前**拦截或按失败退款处理，不会出现「扣了钱没有产出且不退」。

## 11. 接口清单

### 11.1 C 端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/products/:sku` | 商品详情（结算页用） |
| GET | `/membership/plans`、`/membership/me` | 会员套餐 / 我的会员 |
| POST | `/membership/subscribe`、`/membership/cancel` | 订阅 / 取消自动续费 |
| GET | `/credits/balance`、`/credits/lots`、`/credits/ledger` | 余额 / 批次 / 流水 |
| GET | `/orders`、`/orders/:id` | 我的订单 / 订单详情 |
| POST | `/orders/:id/pay`、`/orders/:id/cancel` | 沙箱支付 / 取消未支付订单 |
| POST | `/payments/:orderId/intent` | 发起真实渠道支付，返回 `redirect` 或 `qrcode` |
| POST | `/payments/callback/:channel` | 渠道回调（公开、无信封、`@Res()` 直写） |
| GET | `/payments/:orderId/status` | 支付状态轮询 |
| GET/POST | `/invoices`、`/invoices/:id/file` | 申请开票 / 列表 / 可打印 HTML |
| GET | `/marketing/popup`、`/marketing/invites`、`/marketing/checkin`、`/marketing/campaigns` | 营销 |

### 11.2 后台

见 `docs/admin-detailed-design.md` §9–§13。统一约束：退款、人工调价、积分调整、发票开具属高危动作，必填原因并写审计。

## 12. 前端改造点

| 位置 | 现状 |
| --- | --- |
| 价目 | `/packages` 与 `/checkout/:sku` 的价格与积分数一律读 `GET /products`，前端不再硬编码价目 |
| 工具页计费文案 | `useCreditLabel(capabilityId)` 统一生成「本次消耗 N 积分」/「免费」；能力清单未到达时返回 `null`，调用方不显示任何价格（显示 0 会被读成免费） |
| 余额不足 | 后端 402 为准；前端只做提前提示，不自行拦截 |
| 支付结果 | 轮询 `/payments/:orderId/status`，沙箱与真实通道走同一状态口径 |
| 邀请与签到 | 展示真实邀请码与奖励状态；未达成条件时如实说明 |
| 积分明细 | `/credits` 展示批次与流水，即将过期批次单独提示 |
