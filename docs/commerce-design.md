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
| 退款规则默认值 | `backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` |

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

积分用**微积分**（1 积分 = 1,000,000 微积分）做全程整数运算，API 边界才换算成积分。

| 模型 | 关键字段 | 说明 |
| --- | --- | --- |
| `CreditLot` | `userId / source / orderId? / totalMicrocredits / remainingMicrocredits / expireAt?` | 批次。`expireAt` 为空 = 永久有效 |
| `CreditLedgerEntry` | `userId / type / amountMicrocredits(有符号) / availableDelta / reservedDelta / availableAfter / reservedAfter / billingOrderId / lotId? / referenceKey? / note? / actorUserId?` | 流水，只追加，永不 UPDATE / DELETE |
| `CreditAccount` | `userId / availableMicrocredits / reservedMicrocredits / version` | 用户级余额权威。`available + reserved == Σ CreditLot.remaining` |
| `CreditReservationItem` | `billingOrderId / lotId / microcredits` | 预授权明细，结算与退款按此原路回填 |

`CreditLedgerEntry.type`：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim` / `reserve` / `refund`。`referenceKey` 唯一，保证回调重放与批量重试不重复发放（幂等键格式：`credit-grant:<key>` / `credit-consume:<key>`）。

> `CreditLedger`（Int 积分口径的旧表）已废弃，全仓无引用，仅留历史数据待迁移清理。禁止新增写入 —— 详见 schema 内注释。

### 2.2 扣减规则

- **FEFO**：先到期先扣，`expireAt` 为 `NULL` 视为最晚到期。
- 跨批次扣减，余额不足**整体回滚**并报 `40002`（前端按 402 语义处理）。
- 并发用条件更新 `updateMany({ where: { availableMicrocredits: { gte: amount } } })`，不引入行锁：自研 adapter 只支持 SERIALIZABLE，SQLite 本身单写者。
- 每次变动写 `availableAfter` / `reservedAfter`，流水可独立还原任意时刻余额。
- 人工增减**备注可选**（填写时落进流水 `note`，留空时写系统说明），落 `admin_adjust` 并由审计自动记录操作人与动作。
- 批量调整 / CSV 导入**必须带幂等键**，键内包含行号：同一批重试不会二次发放。

### 2.3 到期回收

调度任务 `credit-expire` 扫描到期批次：剩余积分写 `expire` 流水并清零批次。到期时间不因任何操作延长。

- 单轮上限 500 条，剩余留到下一轮；逐条独立事务 + 逐条容错，一条失败不中断整轮。
- 账户可用余额扣减走 CAS（`available >= 批次剩余`），不一致时中止并留待人工对账，**绝不把余额写成负数**。

### 2.4 账实核对

`GET /admin/credits/audit` 比对 `available + reserved` 与「Σ 批次剩余」（只读，不修数）。差额必须人工判断是漏扣还是漏退，自动抹平等于掩盖资损。

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

1. **履约快照**：`OrderItem` 复制 `skuSnapshot / nameSnapshot / priceCentsSnapshot / creditsSnapshot / validDaysSnapshot / grantTypeSnapshot / stockReservedSnapshot`；`Order.totalCents / discountCents / paidCents` 在支付成功时定稿。商品改价、下架、切换发放方式或切换销售策略均不追溯历史订单；支付成功时按订单项快照决定是否自动发分、是否把库存占用转为已售。
2. **幂等下单**：`@@unique([userId, idempotencyKey])`，重复提交返回同一订单。
3. **退款上限按实付**：`paidCents = totalCents - discountCents`；上限用 `paidCents` 而非 `totalCents`，否则用券订单会多退。

`couponSnapshot` 保存当时的券或活动规则：券被改或删掉后，历史订单的优惠金额仍解释得清。限量券以 `usedCount + pending 订单数` 计算剩余名额：下单事务内锁券并复查，pending 订单预占名额，支付时在同一事务核销，取消/超时自动释放。

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

1. 退款事务先对订单执行 no-op 条件更新取得行锁，再重读最新订单、成功支付、成功退款记录与累计退款金额；金额/时间窗/比例/积分规则必须在锁内完整重跑，事务外首轮校验只用于快速失败。
2. 校验通过后落 `Refund(status='processing')`，用它的 id 作渠道幂等键 `outRefundNo`。已有 `processing` 退款时必须在同一锁内拒绝第二笔；失败退款单复用也必须以 `status='failed'` 条件更新，抢不到即返回 409。
3. 调渠道：失败置 `failed` 并抛 `50302`，**订单状态与积分都不变**。渠道结果未知时同金额重试复用原退款号；运营已在渠道后台确认失败的单是明确终态，重试必须新建退款单。
4. 渠道成功才按**累计退款比例**回收积分、迁移订单状态、累加 `refundedCents`；渠道调用必须使用锁内重新查出的实际成功 `Payment.channel/providerConfigId`。
   第 N 笔退款的回收目标为 `floor(本单发放积分 × 累计已退金额 / 实付金额)`，
   再减去此前退款单已经记录的“已回收 + 无法回收”份额。这样多次部分退款不会在首笔
   就扣完整单积分，也不会在后续退款重复或漏扣；最后一笔退完时累计份额恰好等于发放量。

微信返回 `PROCESSING` 时保持 `processing`，本地账不动，需人工到商户后台确认。`channel='manual'`（后台标记已支付）不调渠道。

**绝不允许「只改库、假装退过钱」。**

### 6.3 回收积分的两种缺口

`Refund.creditsReclaimed` 记录实际扣回数，`creditsUnreclaimable` 记录因已消耗而扣不回的数量。后者必须如实记录，否则对账会以为系统丢了积分。

退款只回收**本订单产生的积分批次**，按本单批次到期时间 FEFO 扣减；本单批次不足时，
缺口记入 `creditsUnreclaimable`，不能转而扣用户其它订单的积分。否则一笔退款会实际
没收另一笔仍有效的付费权益。`refund.allowConsumedTask=false` 时，`40907` 检查的是
**本次退款按累计比例应回收份额**，不是整单发放量：部分退款只要本单剩余批次覆盖本次
份额即可通过，后续退款再按同一累计口径计算。

会员单全额退款只撤销该订单产生的周期，并在同一事务内重算当前会员投影：
退未来一期不影响当前周期；退当前有效一期会立即结束当下权益，但仍保留之后
已经付费的周期；没有当前或未来周期后才整条失效。只有**实际终止当前有效会员**
时响应 `membershipTerminated=true`。订单上的 `membershipPeriodStartAt/EndAt` 保存
不可覆盖的周期快照，`membershipPeriodRevokedAt` 保存退款审计边界。

### 6.4 退款与发票联动

- 存在 `processing` 退款时，用户不能申请发票，后台也不能开具已有待开发票。
- 开具前在事务内重新读取订单状态与累计退款，只有 `paid / partial_refunded` 且票面不超过 `paidCents - refundedCents` 才能开具；全额退款后的待开发票必须驳回。
- 退款成功后响应带 `invoiceFollowUp`：待开发票仅在票面超过退款后剩余可开票金额时提示运营驳回，已开具发票提示线下冲红并回系统登记；仍被余额覆盖的待开发票不误报。不能只把提示留在一个需要运营主动发现的列表里。
- 后台发票告警把“可正常开具”和“退款后不可开具/退款处理中”拆成两类计数，避免永久无法开具的票长期混在待办里。

## 7. 会员

`MembershipPlan`（`code / priceCents / durationDays / monthlyCredits / perks / status`）→ `Membership`（`planId / perksSnapshot / monthlyCreditsSnapshot / startAt / expiresAt / status / nextCreditAt / orderId?`）。

- **激活唯一路径**：订单支付成功且 `membershipAppliedAt` 为空才激活。该字段与订单同生命周期——不能靠 `Membership.orderId` 判断，续费时它会指向最新一笔，旧订单重放即可白拿一期。
- **下单即冻结、支付后定周期**：会员单创建时把价格、`durationDays`、`perks`、`monthlyCredits` 和套餐映射的用户分组编码快照写入订单；支付前运营改套餐不会追溯影响已创建订单。支付成功后才根据当前已付周期计算新周期的 `membershipPeriodStartAt/EndAt`。
- **周期快照落在订单上**：`membershipPeriodStartAt/EndAt` 记录该订单实际买到的区间，`membershipDurationDaysSnapshot/membershipPerksSnapshot/monthlyCreditsSnapshot/membershipUserGroupCodeSnapshot` 记录下单时承诺的周期、权益与计费分组。`Membership` 只是一人一行的当前投影，不能据此反推某笔续费订单。用户分组解析和后台分组用户数都优先读订单快照，避免改套餐映射追溯改变存量会员的渠道可见性与倍率。
- **提前续费延后生效**：当前周期仍有效时，新订单从当前周期结束时间顺延；不提前切换套餐、不提前发下一期积分，也不提前改变用户分组。周期到达后由调度器切换投影并按新周期订单发分；激活、周期切换、退款撤销和到期在事务提交后立即失效用户分组缓存并发布目录版本，不能等 30 秒 TTL。
- **退款只撤对应周期**：全额退款按未撤销的订单周期重算到期时间、套餐与 `nextCreditAt`。退当前期但仍有未来已付周期时，空档期按非会员处理，未来周期到点后再恢复；取消自动续费的用户退款后仍保持 `cancelled`。
- 月度积分由调度任务 `membership` 按 `nextCreditAt` 发放。发放时按发分时点匹配未撤销、仍在有效期内的订单周期，把 `CreditLot.orderId` 写成该周期订单，并在同一事务内累加订单 `grantedCredits`；退款因此能按订单回收首期和后续月份的实际发放量。首期与月度批次统一 `validDays: 30`，不滚存。
- 到期失效同由该任务处理，失效前先查后更，以便给用户发站内消息。
- 取消自动续费后 `status='cancelled'`，已付周期保留至 `expiresAt`，已预付未来周期的月度积分仍按周期发放；续费可重新激活并顺延。
- `grantedCredits` 只记录实际到账的积分批次：会员首期和后续月度积分均在真正发放时累加，不能把尚未开始的未来周期预记到订单上。
- 用户分组按“当前时刻真正覆盖的未撤销订单周期”映射；只有旧数据没有订单周期快照时才回退 `Membership.plan`。
- 会员折扣与用量落 `MembershipUsage`（`orderId @unique`、`savedCents`），用于统计权益被用掉多少。
- 后台 `/admin/membership-plans` 是套餐价的唯一写入入口：编码创建后不可改；改价/改权益只影响之后的订单，存量会员按 `perksSnapshot` 保留原权益；下架不终止已付周期。

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

同一订单保留完整申请历史，但同一时刻最多一张有效票（`activeOrderId @unique`，`pending / issued / red_flushed` 占用，驳回后释放）。金额取申请时 `paidCents - refundedCents` 快照；输出可打印 HTML，零 PDF 依赖。开具自动写审计；驳回要求填写原因，原因会回显给用户并写入审计。冲红只登记台账并保留原件。

### 9.2 对账

- CSV 手写 RFC4180 解析 + 表头别名；金额单位按表头是否含 `cent|分` 判定。
- 差异结果：`matched` / `recovered` / `local_order_not_found` / `provider_record_missing` / `amount_mismatch` / `trade_no_mismatch` / `duplicate_charge` / `credit_failed`。同一商户订单号出现第二个不同渠道交易号时落 `duplicate_charge`，同一交易号重复导出行去重。
- **处置只改状态与备注，不改钱**。处置权只给财务（`finance.reconcile`）。

## 10. 生成扣费与退款

| 阶段 | 行为 |
| --- | --- |
| 创建任务 | 取生效价 → 预授权（reserve）→ 建任务并写 `task.creditCost` 快照，三步**同一事务** |
| 结算 | 按上游 usage 结算，差额回填原批次；Token 超授权按上限截断 |
| 任务失败 / 取消 | 按任务快照**原额退还**，不重新取价 |
| 退款成功 | 写 `refund_reclaim` 类流水，并给用户发站内消息（仅退款真的成功时） |

无可用模型线路、遮罩不受支持等情况都在**扣费之前**拦截或按失败退款处理，不会出现「扣了钱没有产出且不退」。

### 10.1 生效价的优先级

`/capabilities` 下发给用户看的价与实际扣费的价**必须是同一个数**，否则就是「后台显示已保存，用户仍按旧价扣费」。

| 顺序 | 来源 | 生效条件 |
| --- | --- | --- |
| 1 | 限时免费活动（`campaign.type = limited_free`） | 活动期内，金额直接置 0 并记 `promotionId` |
| 2 | 后台能力覆盖价 `SystemSetting['creditPrice.<capabilityId>']` | 仅 `fixed_request` + `unified` 价格策略 |
| 3 | 线路价格档（`pricePolicy = channel`）/ 前台模型标量价（`unified`） | 兜底 |
| 4 | `CapabilityDef.creditCost` | 仅在后台展示「代码默认值」用，不作扣费依据 |

按量计价（`per_second` / `token`）**不接受能力覆盖价** ——「一次多少钱」无法换算成每秒 / 每 token 单价；`channel` 策略同理，绕过渠道价会让渠道结算与账单脱钩。这两种情况后台改价页的 `source` 会显示 `registry`，运营据此判断改价不生效的原因。

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
| GET/POST | `/payments/callback/:providerId/:configId` | 渠道回调（公开、无信封、`@Res()` 直写；易支付 GET） |
| GET | `/payments/:orderId/status` | 支付状态轮询 |
| GET/POST | `/invoices`、`/invoices/:id/file` | 申请开票 / 列表 / 可打印 HTML |
| GET | `/marketing/popup`、`/marketing/invites`、`/marketing/checkin`、`/marketing/campaigns` | 营销 |

### 11.2 后台

见 `docs/admin-detailed-design.md` §9–§13。统一约束：退款、人工调价、积分调整、发票开具、会员套餐变更属高危动作，自动写审计。

积分相关端点：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/credits` | `credit.read` | 用户积分总览（分页） |
| GET | `/admin/credits/export` | `credit.read` + `data.export` | 总览导出 |
| GET | `/admin/credits/audit` | `credit.read` | **账实核对**（只读） |
| GET | `/admin/credits/:userId/lots` | `credit.read` | 批次明细 |
| GET | `/admin/credits/:userId/ledger` | `credit.read` | 流水 |
| POST | `/admin/credits/adjust` | `credit.adjust` | 单条调整，`reason` 可选，审计自动留痕 |
| POST | `/admin/credits/batch-adjust` | `credit.adjust` | 批量调整，`reason` 可选 + 建议 `idempotencyKey` |
| POST | `/admin/credits/import` | `credit.adjust` | CSV 导入，`importKey` 幂等 |

## 12. 前端改造点

| 位置 | 现状 |
| --- | --- |
| 价目 | `/packages` 与 `/checkout/:sku` 的价格与积分数一律读 `GET /products`，前端不再硬编码价目 |
| 工具页计费文案 | `useCreditLabel(capabilityId)` 统一生成「本次消耗 N 积分」/「免费」；能力清单未到达时返回 `null`，调用方不显示任何价格（显示 0 会被读成免费） |
| 余额不足 | 后端 402 为准；前端只做提前提示，不自行拦截 |
| 支付结果 | 轮询 `/payments/:orderId/status`，沙箱与真实通道走同一状态口径 |
| 邀请与签到 | 展示真实邀请码与奖励状态；未达成条件时如实说明 |
| 积分明细 | `/credits` 展示批次与流水，即将过期批次单独提示 |
