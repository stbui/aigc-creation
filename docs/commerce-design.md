# 支付 / 积分 / 订单 / 商品 · 功能设计

货觉AI · MVP ｜ 2026-10-19 ｜ 状态：**设计已落地**（B1–B8，2026-10-21；退款规则 / 支付通道 / 对账 / 发票的现状见 [`CLAUDE.md`](../CLAUDE.md)「商业域」）
上游文档：`docs/admin-console-design.md`（其 §0-5「不做计费后台」已被本文档**取代**，该节需回填指向本文）
总纲：`docs/admin-suite-design.md`。本文的 K1-K5 批次已并入总纲 §12 的 M6-M9/M15/M16。
**PRD**：`docs/admin-prd.md`（后台管理系统需求）；整站产品需求见 `docs/prd.md`。定价已按「8 项 mock 不上架」重裁：可售 7 项全为 real，原「多图融合 20」的裁定作废。

---

## 0. 结论先行

| # | 裁定项 | 结论 | 依据 |
|---|---|---|---|
| C1 | 积分怎么存 | **不是单一余额数字，是「批次账本」**：一笔购买产生 1+ 个 `CreditLot`（有到期日），扣减按 FEFO（先到期先消耗） | 订阅积分**分月发放且有有效期**（季卡"90天，每月发放"、周卡 7 天），加油包永久。不分批次就无法表达"下周发放的积分"和"上月要过期的积分" |
| C2 | 商品（SKU） | **入库，删除前端两套硬编码价目**，统一 `GET /api/v1/products` 下发 | 前端现有**两套互相冲突**的价目（详见 §1 冲突 B）。沿用 `capability.registry.ts` 的单一事实源思路 |
| C3 | 订单 | 6 态状态机 + 幂等下单 + 金额快照 | 商品改价不能影响历史订单；重复提交不能重复扣款 |
| C4 | 支付通道 | 抽象 `PAYMENT_PROVIDER` token，**MVP 只实现沙箱**，微信/支付宝留位不接 | 无商户号。**复用本仓已有的 `IMAGE_PROVIDER` 抽象模式**（`generate.service.ts:19` 注入），不新造架构 |
| C5 | 生成扣费 | 在 `generate.service.ts:51` 建任务**之前**原子扣；`processTask` 失败分支**自动退还** | 扣费必须与建任务同事务，否则会出现"扣了钱没任务"或"有任务没扣钱" |
| C6 | 金额单位 | **整数「分」**存储（¥9.90 → 990），禁止浮点 | SQLite 无友好 Decimal；浮点数算钱必出账差 |
| C7 | 并发安全 | **不引入行锁**，用 `updateMany({ where: { remaining: { gte: cost } } })` 条件更新 + SERIALIZABLE 事务 | 自研 adapter 只支持 SERIALIZABLE（`node-sqlite-adapter.ts:417-429`，`BEGIN` 独占写），SQLite 本身单写者，行锁是伪需求 |
| C8 | 后台形态 | 后台新增 4 模块：商品管理 / 订单管理 / 积分账本 / 支付流水 | 回填 `admin-console-design.md` §4 |

一句话：**先建账（积分），再建商品（SKU），再建订单，最后接支付**。支付是最后一步且可插拔，账本错了后面全错。

---

## 1. 现状事实基线

全部实读，含 3 处现存冲突。

### 1.1 现状

| 事实 | 出处 | 对设计的约束 |
|---|---|---|
| 后端**零**支付/积分/订单/商品代码（grep `payment|points|order|checkout|recharge|wallet|billing` 全库零命中业务代码） | `backend/src/**` | 四个域全新 |
| 数据模型仅 4 表：`User` / `Project` / `Asset` / `GenerationTask` | `backend/prisma/schema.prisma` | 需新增 **5** 表（D7 删 `ProductCapabilityPrice`） |
| `CapabilityDef` **无 cost 字段**（grep `cost\|credit\|point\|price` 仅命中 `selling_points` 文案） | `capability.registry.ts` | 单任务消耗价无处可查，必须加进 registry |
| 建任务处无任何计费钩子，直接 `create` 后 `setImmediate` | `generate.service.ts:51-67` | 扣费钩子插在 `:51` 之前 |
| adapter 仅支持 SERIALIZABLE 事务 | `node-sqlite-adapter.ts:417-429` | 无隔离级别可选，靠条件更新而非锁 |
| 支付 UI 有参考站版式证据但未复刻：`.pkg-payment-options`（支付宝 #009FE8 / 微信 #24B340）、`.pkg-pay-btn`、`.pkg-result-card`、`.pkg-wechat-qr` | `global.css:8552-8553` | 支付确认层有版式基准，非凭空设计 |
| 积分商城购买按钮 `disabled` + 诚实披露 | `PackagesPage.tsx:78-83` | 需真实订单才能解除 |
| 邀请奖励页自述无积分体系 | `InvitationsPage.tsx:72,107` | 赠送积分是新增能力，不是补漏 |

### 1.2 冲突 A：单任务积分价三套口径并存

| 页面 | 标注 | 出处 |
|---|---|---|
| 智能扩图 / 图片翻译 / 局部重绘 / 商品换色 / 产品精修 / 旋转角度 | 「本次消耗 **5** 积分」 | `ImageExpandPage.tsx:56`、`ImageTranslatePage.tsx:38`、`LocalRedrawPage.tsx:48`、`ProductRecolorPage.tsx:45`、`ProductRetouchPage.tsx:48`、`RotateAnglePage.tsx:67` |
| 多图融合 | 「本次消耗 **40** 积分」 | `MultiFusionPage.tsx:75` `CREDIT_PER_RUN = 40` |
| 商品SKU图 | 「本次消耗 **0** 积分」 | `ProductSkuPage.tsx:154` |
| 一键抠图 / 去水印 | 「**限时免费**」 | `BackgroundRemovePage.tsx:45`、`WatermarkRemovePage.tsx:47` |
| **商品页价目反推** | 加油包「100 积分 · 可生成 **10** 张图片」→ **10 积分/图**；季卡「1100 积分 · 110 张图」→ **10 积分/图**；全量包「2000 积分 · 200 张图」→ **10 积分/图** | `LandingPage.tsx:146-151`、`:104-131` |

**三档消耗价（5 / 40 / 0）与商品页反推的 10 积分/图互斥。** 这不是文案问题，是定价模型未定：若 10 积分/图为准，则 6 个工具页的「5积分」全错，且多图融合（双输入）是否 40 还是 20 无依据。

### 1.3 冲突 B：两套价目并存且单价差 5 倍

| SKU | `LandingPage.tsx`（用户 2026-10-17 决策「完全照搬」参考站实拍） | `PackagesPage.tsx:23-31`（自称「版式示例数据」） |
|---|---|---|
| 入门档 | 加油包基础 ¥19.90 → 100 积分（**¥0.199/积分**） | 入门包 ¥39 → 1,000 积分（**¥0.039/积分**） |
| 中档 | 进阶 ¥69.90 → 400 积分（¥0.175/积分） | 成长包 ¥169 → 5,000 积分（¥0.034/积分） |
| 高档 | 全站 ¥129.90 → 800 积分（¥0.162/积分） | 专业包 ¥599 → 20,000 积分（¥0.030/积分） |
| 顶档 | 全量 ¥299.90 → 2,000 积分（¥0.150/积分） | 企业定制 面议 |
| 订阅 | 周卡 ¥9.90 / 月卡 ¥39.90 / 季卡 ¥109 / 年卡 ¥359 | **完全没有** |

同名"积分"单价差 5 倍，且一边有订阅一边没有。**必须裁定唯一价目源。**

### 1.4 冲突 C：免费口径不统一

「限时免费」（2 个能力）是纯文案，无任何计费字段可承载；而「本次消耗0积分」（SKU 图）是明确 0 但同样无字段。二者语义不同（限时活动 vs 永久免费），若都塞进一个 `cost` 数字会丢失"限时"语义。

---

## 2. 领域模型

```
Product (SKU)  ──下单──>  Order  ──支付──>  Payment
                        │                  (可插拔通道)
                        │支付成功
                        ↓
                  CreditLot (积分批次，有到期日)
                        │ 消耗/退还
                        ↓
                  CreditLedger (流水，只追加)
```

四域职责边界：

| 域 | 唯一职责 | 不负责 |
|---|---|---|
| 商品 | 定义卖什么、卖多少、有效期规则、消耗价表 | 不管钱 |
| 订单 | 一次购买的快照与状态推进 | 不直接改余额（只写流水） |
| 支付 | 与外部通道的协议适配、回调验签 | 不决定发多少积分（订单决定） |
| 积分 | 余额的唯一裁决者（批次 + 流水） | 不碰订单状态 |

**核心约束：余额永远由流水推导，代码里不存在"直接改 balance 数字"的分支。**

---

## 3. 数据模型

### 3.1 User 扩列

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `role` | String | `"user"` | 白名单 `user`/`admin`，见 `admin-console-design.md` §5 |
| `status` | String | `"active"` | 白名单 `active`/`disabled`/`deleted` |

### 3.2 新增 5 表

| 模型 | 关键字段 | 说明 |
|---|---|---|
| `Product` | `id / sku(唯一) / title / subtitle / type / priceCents / originalPriceCents / credits / creditsValidDays / grantPlan / features(JSON) / badge / sort / status / createdAt / updatedAt` | SKU 主表 |
| ~~`ProductCapabilityPrice`~~ | ~~`productId / capability / cost`~~ | ❌ **建议删除（PRD §3.4 / D7）**：本期无会员价、无产品线，机制过重。消耗价直接由 `CapabilityDef.creditCost` + `SystemSetting` 承载 |
| `Order` | `id / orderNo(唯一) / userId / status / totalCents / payChannel / payTransactionId / idempotencyKey / paidAt / expiredAt / cancelledAt / refundedAt / snapshot(JSON) / createdAt / updatedAt` | 订单 |
| `OrderItem` | `id / orderId / productId / titleSnapshot / priceCentsSnapshot / creditsSnapshot / creditsValidDaysSnapshot` | 订单行，**全字段快照** |
| `CreditLot` | `id / userId / orderId? / source / totalCredits / remainingCredits / grantedAt / expireAt? / @@index([userId, expireAt])` | 积分批次，余额 = Σ `remainingCredits` |
| `CreditLedger` | `id / userId / lotId? / type / amount(有符号) / refType / refId / note / createdAt` | 流水，**只追加，永不 UPDATE/DELETE** |

### 3.3 字段取值白名单（SQLite 无 enum，沿用本仓既有约定）

| 字段 | 白名单 |
|---|---|
| `Product.type` | `subscription` \| `addon` |
| `Product.status` | `on` \| `off` |
| `Product.grantPlan` | `once`（一次性发放）\| `monthly`（按月发放，对应季卡/年卡"每月发放"）\| `none`（不下发积分，视为纯权益） |
| `Order.status` | `created` → `paying` → `paid` → `fulfilled`；旁支 `expired` / `cancelled` / `refunded` |
| `Order.payChannel` | `sandbox` \| `wechat` \| `alipay` \| `manual`（后台手工核销） |
| `CreditLot.source` | `purchase` \| `gift` \| `reward` \| `refund` \| `adjust` |
| `CreditLedger.type` | `grant` \| `consume` \| `refund` \| `expire` \| `adjust` |

### 3.4 积分手算规则

```
可用余额 = Σ CreditLot.remainingCredits (where expireAt IS NULL OR expireAt > now)
FEFO 扣减 = 按 expireAt ASC 排序（NULL 视为最晚），逐批扣
```

> **PRD §3.4 / D7 修订建议**：删除 `CreditLedger.balanceAfter`。余额应由 `CreditLot.remaining` 唯一推导，冗余余额快照在并发下必然对不上，且会引发对账疑问。查询余额时实时聚合 `CreditLot` 即可（个人量级下开销可忽略）。

---

## 4. 商品（SKU）设计

### 4.1 两类商品的差异

| 维度 | `subscription` 订阅卡 | `addon` 加油包 |
|---|---|---|
| 有效期 | 有（`creditsValidDays`：7/30/90/365） | 无（永久，`expireAt = NULL`） |
| 发放 | `grantPlan=monthly` 时按月分批（季卡 90 天每月发放） | `grantPlan=once` 一次性 |
| 权益 | 快通道 / 多任务并发 / 加油包 95 折 | 仅积分 |
| 定价基准 | 落地页实拍价 | 落地页实拍价 |

### 4.2 定价裁定（P0，冲突 B）

**建议以 `LandingPage.tsx` 为准**（用户 2026-10-17 决策「完全照搬」参考站实拍价），`PackagesPage` 的 ¥39/1000 积分示例价作废。理由：前者是实拍证据 + 已决策，后者是自述"无可见证据"的版式示例。

落地后商品表初值（seed）：

| sku | title | type | priceCents | credits | creditsValidDays | grantPlan |
|---|---|---|---|---|---|---|
| `sub_week` | 周卡 | subscription | 990 | 100 | 7 | once |
| `sub_month` | 月卡 | subscription | 3990 | 260 | 30 | once |
| `sub_quarter` | 季卡 | subscription | 10900 | 1100 | 90 | monthly |
| `sub_year` | 年卡 | subscription | 35900 | 4880 | 365 | monthly |
| `addon_basic` | 基础加油包 | addon | 1990 | 100 | 0（永久） | once |
| `addon_pro` | 进阶加油包 | addon | 6990 | 400 | 0 | once |
| `addon_site` | 全站加油包 | addon | 12990 | 800 | 0 | once |
| `addon_full` | 全量加油包 | addon | 29990 | 2000 | 0 | once |

`originalPriceCents` 存划线价（29.90 / 139.90 / 379.90 / 1249.90 等），仅展示，**不参与任何计算**。

### 4.3 定价裁定（P0）

> **D2 已定：8 项mock 能力暂不上架。** 故下表已按可售 7 项重写，原「商品SKU图 0 / 多图融合 20」两条作废。

| 能力 | cost | 理由 |
|---|---|---|
| 一键抠图 `matting` | `0` + `freeWindowEnd` 限时标记 | 保留"限时免费"语义（冲突 C），限时结束由后台改价恢复 |
| 商品主图 `main_image` | `10` | 1 图 = 10 积分，与商品页反推口径一致 |
| 商品详情图 `detail_image` | `10` | 同上 |
| 智能扩图 `expand` | `10` | 同上 |
| 产品精修 `enhance` | `10` | 同上 |
| 商品换色 `recolor` | `10` | 同上 |
| 旋转角度 `rotate` | `10` | 同上 |
| ~~其余 8 项（mock）~~ | — | D2 裁定不上架，不定价 |

**这条不裁定，积分账本上线即错账。**

### 4.4 能力消耗价的数据结构（D7 简化后）

```
最终 cost = SystemSetting['creditPrice.<capabilityId>']   // 后台可改，优先
          ?? capability.registry.ts 的 creditCost           // 代码默认值，兜底
          ?? 0
```

**PRD §3.4 修订**：原设计的三级链路（含 `ProductCapabilityPrice` 会员价表）**本期删除**。本期只有个人轨、无会员价、无产品线，机制过重。消耗价两个来源足够，且都符合既有纪律：

- `registry.ts` 的 `creditCost` —— 与 `mode` 同源，符合单一事实源
- `SystemSetting` —— 运行时可改，不发版调整定价

「新增能力未声明消耗价则默认免费」的漏洞，由 DTO 白名单与 registry 校验堵住。

将来真要做会员专属价/产品线定价，再拆出 `ProductCapabilityPrice` 表。

### 4.5 ⚠️ 订阅卡权益无数据支撑（阻塞本节上线）

`LandingPage.tsx:93-133` 的订阅卡声明了 5 类权益，**commerce 设计的 `Product` 表只能表达第1 类**：

| 声明 | 位置 | `Product` 是否有对应字段 |
|---|---|---|
| 可生成 10/26/110/488 张图片 | `features[0]` | ✅ 由 `credits` ÷ 10 推导 |
| **送 70/320/850/1900 次 AI 修图** | `features[1]` | ❌ **无** |
| 专享快速生成通道 2K/4K | `extras[0]` | ❌ **无** |
| 同时处理多个任务 | `extras[1]` | ❌ **无** |
| **加油包会员专享 95 折** | `extras[2]` | ❌ **无** |

**这些文案已在营销首页上收费展示**。照本设计实施，5 条承诺兑现不了 4 条，构成虚假宣传。

**推荐处置**：删除无载体的 4 类权益，只留「可生成 N 张图片」与有效期。成本最低，立刻消除风险。若要保留全部权益，则需新增 `ProductEntitlement` + `UserEntitlement` 两表并落地限分辨率/并发/折扣三个能力 —— 工作量约等于再做一遍 commerce。

---

## 5. 订单设计

### 5.1 状态机

```
created ──支付发起──> paying ──回调成功──> paid ──发积分──> fulfilled
   │                    │                     │
   │                    ├──回调失败/关闭──────┘
   ├──用户取消──> cancelled
   └──超时(15min)──> expired

fulfilled ──后台退款──> refunded（扣回未消耗积分）
```

| 终态 | 说明 |
|---|---|
| `fulfilled` | 积分批次已生成，订单完成 |
| `expired` | 超时未支付，前端轮询订单状态时据此引导重下单 |
| `cancelled` | 用户主动取消 |
| `refunded` | 全额退款，积分按 lot 剩余量扣回 |

### 5.2 三条硬规则

| 规则 | 实现 |
|---|---|
| **金额快照** | 下单时把 `Product` 全字段写进 `OrderItem.*Snapshot`，商品后续改价/下架不影响历史订单 |
| **幂等下单** | `POST /orders` 必须带 `idempotencyKey`（前端生成 UUID）；同 key 重复请求返回同一订单，不重复建单 |
| **幂等回调** | `Payment` 回调按 `payTransactionId` 查重；已 `paid` 的订单重复回调直接返回成功，不重复发积分 |

### 5.3 订单号

`HJ` + `yyyyMMddHHmmss` + 6 位随机（示例 `HJ20261019173012839274`）。唯一索引，冲突重试 3 次。

---

## 6. 支付设计

### 6.1 通道抽象（复用 `IMAGE_PROVIDER` 模式）

```ts
// backend/src/payments/payment-provider.interface.ts
export interface PaymentProvider {
  readonly channel: 'sandbox' | 'wechat' | 'alipay';
  /** 发起支付，返回前端所需的下单参数（sandbox 返回模拟跳转，wechat 返回 code_url 等） */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** 主动查单（对账用，不依赖回调） */
  queryPayment(transactionId: string): Promise<PaymentQueryResult>;
  /** 回调验签 + 解析 */
  parseNotify(raw: unknown, headers: Record<string, string>): NotifyResult;
}
```

注入 token 沿用现有 `providers/providers.module.ts` 的 `IMAGE_PROVIDER` 写法（`generate.service.ts:19`）。

### 6.2 MVP 只实现 Sandbox

| 项 | 结论 |
|---|---|
| 真实微信/支付宝 | **不接**（无商户号、无证书）。写好接口与 `wechat`/`alipay` 通道占位，凭据到位只加一个 provider 文件 |
| 沙箱行为 | 沙箱页展示订单信息 + 「模拟支付成功 / 模拟支付失败 / 模拟超时」三个按钮，**明标「沙箱环境，不产生真实扣款」** |
| 沙箱支付 = `manual` 通道 | 落 `Order.payChannel = 'sandbox'`，同时记 `CreditLedger`，账目与真实一致，仅支付通道不同 |
| 后台手工核销 | `payChannel='manual'`，管理员在订单详情点「标记已支付」触发 `paid→fulfilled`，**必须写审计日志**（`AdminAuditLog`） |

> 不做"假支付 UI 蒙混"：沙箱按钮必须显式标注，避免截图外泄被误认为已接通支付。

### 6.3 前端支付态（补 `global.css:8552-8553` 记录的三处未复刻）

| 态 | 内容 |
|---|---|
| `.pkg-confirm-card` 下单确认 | 商品名 / 数量 / 应付金额 / 渠道选择（支付宝 #009FE8 / 微信 #24B340 按版式基准） |
| `.pkg-pay-btn` 支付 | 未选渠道禁用并提示 |
| `.pkg-result-card` 支付结果 | 成功（积分到账 + 余额）/ 失败（原因 + 重试）/ 超时（订单已关闭） |
| `.pkg-wechat-qr` 二维码 | 沙箱环境下**不渲染二维码**，改为沙箱按钮（避免假二维码） |

---

## 7. 生成扣费与退款（关键链路）

### 7.1 扣费时机

```
POST /generate
  1. 现有校验（项目归属 / capability 存在 / mode 非 planned / 输入图数量 / 素材存在）—— 不变
  2. ★ 新增：解析 cost（§4.4）→ 校验可用余额 → FEFO 原子扣减 + 写 CreditLedger(consume)
  3. ★ 新增：建任务时把 costSnapshot 写入 GenerationTask.creditCost
  4. 现有：create task + setImmediate(processTask)
```

扣减必须在 **SERIALIZABLE 事务内**（条件更新 + 流水），余额不足抛 `AppError(40201, '积分不足', 402)`。

### 7.2 退款时机

| 分支 | 动作 |
|---|---|
| `processTask` 抛错 → 任务置 `failed` | **自动退还**本次扣减的 cost，写 `CreditLedger(refund)`，退到**新 lot**（`expireAt = NULL` 永久），不用原批次过期日 |
| 生成成功 | 不退 |
| 用户删除作品（`removeTask`） | **不退**（已消耗的服务不可撤回），界面明示 |
| 后台手工退单 | 按 lot 剩余量扣回，部分消耗则按比例扣，差额记 `adjust` |

> 退款退到新永久批次而非原批次：原批次可能已过期，退到过期批次等于白送。

**2026-10-22 更新（后台手工退单分支）**：退款不再只是「改库 + 扣回积分」，而是**真的打回渠道**。两段式顺序不可反：校验 → 落 `Refund(status='processing')`（用其 id 作渠道幂等键 `outRefundNo`）→ 调 `PaymentProvider.refund()`（沙箱直通 / `alipay.trade.refund` / 微信 v3 退款）→ **成功才**回收积分、迁移订单状态、累加 `refundedCents`。渠道失败置 `failed` 并抛 `50302`，订单状态与积分不变；微信返回 `PROCESSING` 时保持 `processing`，需人工到商户后台确认（本仓库没有退款回调端点）。`channel='manual'` 的订单无真实资金往来，不调渠道。

### 7.3 需要改动的现有代码

| 文件 | 改动 |
|---|---|
| `capability.registry.ts` | `CapabilityDef` 加 `creditCost?: number`；15 项逐项声明 |
| `generate.service.ts:51` | 建任务前插扣费；`processTask` catch 分支加退还 |
| `prisma/schema.prisma` | `GenerationTask` 加 `creditCost Int @default(0)` |
| `frontend/src/pages/*.tsx`（8 个） | 删掉硬编码 `creditLabel="本次消耗5积分"`，改为读 `capability.creditCost` 动态渲染 |

---

## 8. API 清单

### 8.1 前台（`JwtAuthGuard`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/products` | 商品列表（公开，免登录，与 `/capabilities` 同口径） |
| GET | `/api/v1/products/:sku` | 商品详情 |
| GET | `/api/v1/credits/balance` | 可用余额 + 即将过期提醒 + 批次明细 |
| GET | `/api/v1/credits/ledger?page&pageSize&type` | 我的积分流水 |
| POST | `/api/v1/orders` | 下单（幂等键），返回 `orderNo` + 待支付信息 |
| GET | `/api/v1/orders?status&page&pageSize` | 我的订单 |
| GET | `/api/v1/orders/:orderNo` | 订单详情 |
| POST | `/api/v1/orders/:orderNo/cancel` | 取消订单 |
| POST | `/api/v1/orders/:orderNo/pay` | 发起支付（沙箱） |
| POST | `/api/v1/payments/notify/sandbox` | 沙箱回调（免鉴权，验签逻辑走 provider） |
| GET | `/api/v1/payments/channels` | 可用支付渠道（沙箱时只返回 sandbox + `sandboxOnly: true`） |

### 8.2 后台（`JwtAuthGuard + AdminGuard`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/products`、`/admin/products/:id` | 商品列表/详情 |
| POST | `/admin/products`、`PATCH /admin/products/:id` | 新建/编辑（含上下架 `status`） |
| POST | `/admin/products/:id/prices` | 配置该 SKU 的能力消耗价表 |
| GET | `/admin/credit-prices` | 全站基准消耗价 |
| PUT | `/admin/credit-prices` | 改基准价（含限时免费开关与截止时间） |
| GET | `/admin/orders?status&userId&from&to&page` | 订单列表 |
| GET | `/admin/orders/:orderNo` | 订单详情（含快照、lot、流水） |
| POST | `/admin/orders/:orderNo/mark-paid` | 手工核销（`manual`，写审计） |
| POST | `/admin/orders/:orderNo/refund` | 退款（扣回未消耗积分） |
| GET | `/admin/credits/users?keyword&page` | 用户积分余额总览 |
| GET | `/admin/credits/users/:userId/lots` | 批次明细（含即将过期） |
| POST | `/admin/credits/users/:userId/adjust` | 人工增减（`adjust`，**强制填原因 + 写审计**） |
| GET | `/admin/payments?channel&status&from&to&page` | 支付流水与对账 |
| GET | `/admin/finance/summary` | 营收概览（订单数 / 实收金额 / 退款 / 按 SKU 分布） |

---

## 9. 前端改造点

| 文件 | 现状 | 改动 |
|---|---|---|
| `LandingPage.tsx:92-151` | `PACKAGES` / `ADDON_PACKS` 硬编码 | 改为 `GET /products` 渲染；硬编码数组删除 |
| `PackagesPage.tsx:23-31` | `PACKAGES` 硬编码 + 按钮 `disabled` | 改读接口；解除禁用，接下单 → 沙箱支付 → 结果态 |
| `packages` 8 个工具页 | `creditLabel="本次消耗5积分"` 硬编码 | 改读 `capability.creditCost`；扣费前实时显示余额 |
| `AppLayout.tsx:97-99` | 「本地算力 · 不限次数」 | 改为真实余额 `Wallet 2,340 积分`，点击跳积分明细 |
| `ToolSubmitBar.tsx:58` | `pk-primary-credit` 只渲染文案 | 增加余额不足态：按钮禁用 + 「积分不足，去充值」链接 |
| 新增 `pages/CreditsPage.tsx` | — | 积分明细（余额 / 即将过期 / 流水） |
| 新增 `pages/OrdersPage.tsx` | — | 我的订单 |
| 新增 `pages/CheckoutPage.tsx` | — | 下单确认 + 沙箱支付 |
| 新增 `pages/admin/{ProductsPage,OrdersPage,CreditsPage,PaymentsPage}.tsx` | — | 后台 4 模块 |
| `styles/global.css` | `pkg-*` 59 条规则，支付态未复刻 | 补 `.pkg-confirm-*` / `.pkg-payment-option*` / `.pkg-pay-btn` / `.pkg-result-card` |

---

## 10. 批次划分

| 批次 | 内容 | 前置裁定 |
|---|---|---|
| **K1** | 积分账本：`CreditLot`/`CreditLedger` + FEFO 扣减 + 生成扣费与退款 + `GenerationTask.creditCost` | C1、§4.3 定价 |
| **K2** | 商品：`Product` + seed 8 SKU + `GET /products` + 落地页/商城页去硬编码 + 修复落地页死按钮 + 处理订阅卡无载体权益 | §4.2 价目、§4.3 定价、§4.5 |
| **K3** | 订单 + 沙箱支付：状态机 + 幂等 + `PAYMENT_PROVIDER` 抽象 + Sandbox 实现 + CheckoutPage | — |
| **K4** | 后台 4 模块 + 财务概览 + 审计回填 | `admin-console-design.md` A1 |
| **K5** | 真实通道接入（微信/支付宝） | 商户号到位后另开 |

每批闸口：`prisma:push` → `build` → `typecheck` → 冒烟脚本（新增 `smoke-credits.js` 验证「扣费→失败→退还」余额归零、「并发提交不超扣」）。

---

## 11. 未决项（需裁定后才动代码）

| # | 问题 | 建议 |
|---|---|---|
| 1 | **冲突 B**：以哪套价目为准？ | `LandingPage` 实拍价（¥19.90/100积分 等），`PackagesPage` 示例价作废 |
| 2 | **冲突 A**：单能力消耗价定多少？ | §4.3 建议表（10 / 20 / 0）。不裁定则 K1 无法开始 |
| 3 | **冲突 C**：「限时免费」怎么承载？ | `creditCost=0` + 后台 `freeWindowEnd` 字段，限时结束自动恢复基准价 |
| 4 | 新用户注册送多少积分？ | 建议送 100（够生成 10 张图，与加油包最小档同量级，便于首体验闭环） |
| 5 | 订单超时时长？ | 建议 15 分钟（对齐主流支付体验） |
| 6 | 退款是否退积分还是退钱？ | MVP 只支持**退积分**（本地沙箱无真实资金）；真实通道接入后再支持原路退 |
| 7 | 订阅积分 `monthly` 发放在 MVP 是否实做？ | 建议**先只做 `once`**，`monthly` 字段入库但暂不实现定时发放（无调度器），seed 时季卡/年卡按一次性发放并标注 |

---

## 附录 · 改动文件清单

| 文件 | 改动 | 批次 |
|---|---|---|
| `backend/prisma/schema.prisma` | User 扩 2 列；新增 5 表；`GenerationTask.creditCost` | K1 |
| `backend/src/capabilities/capability.registry.ts` | `CapabilityDef.creditCost` + 15 项声明 | K1 |
| `backend/src/generate/generate.service.ts` | 建任务前扣费、失败退还 | K1 |
| `backend/src/credits/` | 新增模块（lot / ledger / fefo） | K1 |
| `backend/src/products/` | 新增模块（SKU / 价格表） | K2 |
| `backend/src/orders/` | 新增模块（状态机 / 幂等 / 快照） | K3 |
| `backend/src/payments/` | 新增模块（provider 接口 + sandbox） | K3 |
| `backend/src/common/admin.guard.ts` | 新增（见 admin 设计 §5） | A1 |
| `backend/scripts/seed-products.ts` | 新增：8 个 SKU 初值 | K2 |
| `backend/scripts/smoke-credits.js` | 新增：扣费/退款/并发冒烟 | K1 |
| `frontend/src/pages/{LandingPage,PackagesPage}.tsx` | 去硬编码价目，接接口 | K2 |
| `frontend/src/pages/*.tsx`（8 个工具页） | `creditLabel` 改动态 | K1 |
| `frontend/src/pages/{CreditsPage,OrdersPage,CheckoutPage}.tsx` | 新增 | K1/K3 |
| `frontend/src/pages/admin/*.tsx` | 新增 4 页 | K4 |
| `frontend/src/components/AppLayout.tsx` | 顶导余额改真实值 | K2 |
| `frontend/src/lib/api.ts` | 新增 `productsApi` / `creditsApi` / `ordersApi` / `adminApi` | K1–K4 |
| `frontend/src/styles/global.css` | 补支付态 `pkg-*` 规则 | K3 |