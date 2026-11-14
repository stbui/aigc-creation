# 积分明细「业务类型」数据契约与枚举设计

> **状态：裁定完成 · 待实施**（A–J 全部裁定，无剩余阻塞项；本文不含源码改动，改动清单见 §7）
> 日期：2026-11-14 · 适用范围：C 端 `/credits` 积分明细、后台 `/admin/credits` 流水明细
> 事实源：`backend/prisma/schema.prisma`、`backend/src/credits/credit.service.ts`、`backend/src/model/billing/credit-wallet.service.ts`、`backend/src/capabilities/capability.registry.ts`、`frontend/src/pages/credits/*`

---

## 1. 结论摘要

- **【结论 1｜层级】** 「业务类型」与 `CreditLedgerEntry.type` **不是同一层**：`type` 是账本动作（8 值），业务类型是触发场景。设计上作为 `type` 之上的附加维度，**不替换、不扩充 `type` 枚举**——否则 `C_END_LEDGER_TYPES` 白名单、FEFO 批次扣减、退款累计回收全部要跟着改。
- **【结论 2｜落位】** 新增独立列 `businessType`。**不复用 `scene`**：`scene`（`schema.prisma:2007`）已被 billing 占用为「生成场景」（`create`/`print_pattern` 等，`billing.service.ts:290,354`），且历史行已有值，语义冲突无法清洗。
- **【结论 3｜链路断点】** 必须补齐四段：`落库 → projectEntry 投影 → 前端类型 → 展示`。当前 `projectEntry()`（`credit.service.ts:871-905`）不输出 `scene`，前端类型（`admin-console.ts:534-548`）也无对应字段，C 端 `/credits/ledger` 完全无法承载业务类型。
- **【结论 4｜收支】** 收支**不由业务类型决定**，唯一事实源仍是 `amountMicrocredits` 符号（`credit.service.ts:373-374`）；`direction=income|expense` 是查询派生量。业务类型只做展示与筛选，写入时校验方向一致，杜绝双事实源。
- **【结论 5｜文本不可当枚举】** 现状业务来源只能从自由文本 `reason`/`note` 猜（`每日签到 (连续 N 天)`，`marketing.service.ts:2144`），且 C 端 `ledgerRemark()`（`credits/utils.ts:25-28`）会屏蔽 `admin_adjust` 原文。自由文本不具备筛选与对账能力，这是本次要解决的根因。
- **【结论 6｜数据缺口已裁定新增】** 「新用户赠送」当前无触发点，**裁定 D：新增**。落点为注册成功后的发放（`auth.service.ts:119` 之后），沿用「失败不影响注册」范式，配置为单行规则，参数已定：**100 积分 / 永久有效**（裁定 J），详见 §3.5。
- **【结论 7｜清单数量】** 原清单 5 条业务类型中「连续签到奖励」为**笔误重复（裁定 B）**，实际 **4 条流水 / 4 种业务类型**；`+10 / -10` 仅为**示例数据（裁定 C）**，不进入契约约束。
- **【结论 8｜创意生图 = 全部创意生成能力】** 裁定 I：「创意生图扣费」既不是单个能力，也**不限于** `ecommerce_gen` 一组——**AI修图、AI视频扣费一并归入**。覆盖三个 `CapabilityGroup`（`capability-plugin.type.ts:24`、`capability.registry.ts:76-80`）：`ecommerce_gen`（商品主图/商品详情/SKU 图/模板/爆款改图/可购物轮播/多图融合）、`ai_retouch`（改色/图片翻译/扩图/局部重绘/旋转/抠图/去水印/增强）、`ai_video`（自由创作/图生视频）。**扣费类业务类型因此只有 1 个**。
- **【结论 9｜映射不依赖能力组】** 因扣费统一归 `creative_image`，原 R2（扣费侧拿不到 group）**已消解**：只需模态 `image` / `video` 即可判定，无需解析 group。扣费侧 `normalizeCapability()` 已直接给出模态（`capability-config.ts:161-164`），链路退化为一次字符串判断。**唯一例外**：模态为 `text` / `audio` 的 consume 归 `other`，避免文本/音频类计费被误标为「创意生图」。

---

## 2. 现状核读（以实际代码为准）

### 2.1 事实源链路

| 环节 | 位置 | 现状 |
|---|---|---|
| 落库模型 | `schema.prisma:1986` `CreditLedgerEntry` | `type String`、`scene String @default("")`、`note String @default("")`；只追加 |
| 流水类型枚举 | `credit-wallet.service.ts:24-32` `WalletEntryType` | `grant / purchase / admin_adjust / refund_reclaim / reserve / consume / refund / expire` |
| C 端可见白名单 | `credit.service.ts:59-67` `C_END_LEDGER_TYPES` | 7 值，排除中间态 `reserve` |
| 查询校验 | `credit.service.ts:363-374` | `type` 越界 → `AppError(40001, 400)`；`direction` 按符号过滤 |
| 投影 | `credit.service.ts:871-905` `projectEntry()` | 微积分 → 积分口径；不输出 `scene` |
| 接口 | `credits.controller.ts:26-45`、`lib/api.ts:350-363` | `GET /credits/ledger?limit&offset&type&direction` |
| 前端类型 | `admin-console.ts:534-548` | 11 字段，无业务类型 |
| 筛选 | `credits/constants.ts:53-61`、`credits/utils.ts:12-19` | 单 `Select` 7 项；`direction` 与 `type` 挤在同一联合类型 |
| 展示 | `CreditsLedgerPanel.tsx:53-111`、`CreditsLedgerList.tsx:24-27` | 「类型」列渲染 `LEDGER_LABEL`；`amount >= 0` 定正负 |
| 能力分组 | `capability-plugin.type.ts:24`、`capability.registry.ts:76-80` | `ecommerce_gen` / `ai_retouch` / `ai_video` 三组 |
| 模态归一 | `capability-config.ts:161-164` `normalizeCapability()` | 只返回 `text / image / video / audio`，其余空串 |

### 2.2 已确认的断点与债务

| 编号 | 断点 | 证据 | 影响 |
|---|---|---|---|
| D1 | `scene` 写入但从不投影 | `credit-wallet.service.ts:44,570` vs `projectEntry()` | 落库数据对两端均不可见 |
| D2 | C 端与后台两份中文映射文案分叉 | `credits/constants.ts:33-42`「客服调整」vs `admin/credits/constants.ts:9-18`「人工调整」 | 同一笔流水两端叫法不同 |
| D3 | `direction` 与 `type` 挤在同一筛选枚举 | `credits/constants.ts:18-25,53-61` | 新增业务类型筛选会使组合数爆炸 |
| D4 | 业务来源散落在自由文本 | `marketing.service.ts:2144,1730`；`credit-wallet.service.ts:424` | 无法枚举、分组、按业务对账 |
| D5 | 旧表 `CreditLedger`（Int 口径）并存 | `schema.prisma:542`，注释标记废弃 | 新字段只落 `CreditLedgerEntry`，**禁止**写旧表 |
| D6 | 扣费侧只有模态、无能力组 | `normalizeCapability` 白名单仅 4 值 | 因裁定 I 统一归 `creative_image`，模态已足够；**仅文本/音频需例外** |

### 2.3 现有业务触发点

| 业务类型 | 触发点 | `type` | 现有 `reason/note` | 现有文案 |
|---|---|---|---|---|
| 连续签到奖励 | `marketing.service.ts:2115` `checkin()` → `grant()`（`:2139`） | `grant` | `每日签到 (连续 N 天)` | 「发放」 |
| 积分过期 | `credit.service.ts:828` `expireLots()`；`credit-wallet.service.ts:424` | `expire` | `积分到期回收` | 「到期回收」 |
| 创意生图扣费 | billing `consume`（`billing.service.ts:718,894`） | `consume` | 由账单 `note` 决定 | 「生成消耗」 |
| 新用户赠送 | **无**（仅邀请奖励 `marketing.service.ts:1725`，需首次付费） | `grant` | `新用户邀请奖励` | 「发放」 |

#### 2.3.1 「创意生图」覆盖范围（裁定 I：三组全含）

| group | 中文名（代码） | 组内能力 | 产出 | 归入业务类型 |
|---|---|---|---|---|
| `ecommerce_gen` | 电商生图 | `main_image` 商品主图、`detail_image` 商品详情、`sku_image` SKU 图、`template` 模板、`hot_remake` 爆款改图、`shoppable_carousel` 可购物轮播、`multi_fusion` 多图融合 | 图片 | `creative_image` |
| `ai_retouch` | AI修图 | `recolor` 改色、`image_translate` 图片翻译、`expand` 扩图、`local_redraw` 局部重绘、`rotate` 旋转、`matting` 抠图、`remove_watermark` 去水印、`enhance` 增强 | 图片 | `creative_image` |
| `ai_video` | AI视频 | `free_create` 自由创作、`image_to_video` 图生视频 | 视频 | `creative_image` |

> **命名口径差异**：代码里首组叫「电商生图」（`capability.registry.ts:77`），用户口径统一为「创意生图」。决策：**C 端展示文案用「创意生图扣费」，代码枚举用 `creative_image`**；不修改 `CAPABILITY_GROUPS` 的中文名（它是前端侧栏与后台能力列表的既有文案，改动影响面更大，且与积分口径无关）。

---

## 3. 数据契约

### 3.1 字段落位（A 已采纳方案 B）

| 方案 | 做法 | 评价 | 裁定 |
|---|---|---|---|
| A | 复用 `CreditLedgerEntry.scene` | 与 billing 生成场景语义冲突；存量已有值 | ❌ |
| B | 新增 `businessType String @default("")` + `@@index([userId, businessType])` | 语义独立、可筛选、空串兼容历史行 | ✅ **采纳** |
| C | 不落库，前端按 `type + reason` 正则推导 | 违反「前端不做业务判定」；文案一改即失效 | ❌ |

### 3.2 枚举定义（H 已裁定：按新文案）

```ts
// 契约草案（文档内容，未写入源码）
type CreditBusinessType =
  // ── 收入侧
  | 'checkin_streak'     // 连续签到奖励
  | 'new_user_gift'      // 新用户赠送
  | 'purchase'           // 购买获得
  | 'membership_grant'   // 会员月度积分
  | 'invite_reward'      // 邀请奖励
  // ── 支出侧
  | 'creative_image'     // 创意生图扣费  ← 全部 image/video 类生成扣费
  | 'credit_expire'      // 积分过期
  // ── 双向与兜底
  | 'admin_adjust'       // 客服调整
  | 'refund'             // 退款相关
  | 'other';             // 兜底（含 text/audio 类扣费）
```

**共 10 个值**（扣费类仅 1 个，AI修图/AI视频不单列）。

| code | 展示文案 | 收支 | 绑定 `type` | 允许值域 | 触发 / 映射口径 |
|---|---|---|---|---|---|
| `checkin_streak` | 连续签到奖励 | 收入 | `grant` | 正整数 | `marketing.checkin()` |
| `new_user_gift` | 新用户赠送 | 收入 | `grant` | 正整数 | `auth.register()`（**新增**，§3.5） |
| `purchase` | 购买获得 | 收入 | `purchase` | 正整数 | 支付回调 |
| `membership_grant` | 会员月度积分 | 收入 | `grant` | 正整数 | `membership` 调度 |
| `invite_reward` | 邀请奖励 | 收入 | `grant` | 正整数 | 邀请首次付费 |
| `creative_image` | 创意生图扣费 | 支出 | `consume` | 负整数 | 模态 ∈ {`image`, `video`}（含电商生图 / AI修图 / AI视频三组） |
| `credit_expire` | 积分过期 | 支出 | `expire` | 负整数 | `credit-expire` 调度 |
| `admin_adjust` | 客服调整 | 双向 | `admin_adjust` | 非零整数 | 后台人工增减 |
| `refund` | 退款相关 | 双向 | `refund` / `refund_reclaim` | 非零整数 | 退款链路 |
| `other` | 其他 | 双向 | 任意 | 非零整数 | 兜底：模态 `text`/`audio`、组/能力未知、历史行 |

**文案口径（H 裁定落地）**：统一采用新口径，`LEDGER_LABEL` 同步调整——`expire: 到期回收 → 积分过期`、`consume: 生成消耗 → 创意生图扣费`（`consume` 仅在业务类型为 `other` 时兜底显示，见 §5.3）。

#### 3.2.1 映射规则（裁定 I 后极简化）

```
consume 扣费：
  模态 ∈ {image, video}  → creative_image
  模态 ∈ {text, audio}   → other
  模态为空               → other
```

- **不需要**解析 `CapabilityGroup`，也不需要按 `capabilityId` 建表——新增任何图片/视频能力自动归入，零维护；
- 模态取自 `draft.capability`（`billing.service.ts:270,342` 已由 `normalizeCapability()` 归一化）；
- **文本/音频例外必须保留**：`normalizeCapability()` 允许 `text`/`audio`（`capability-config.ts:160-164`）且代理链路（`PROXY_SCENE`，`proxy.constants.ts:10`）可能以任意 `capability` 计费；把这类扣费标成「创意生图」会误导用户；
- 其余业务按触发点直接指定，不做推导。

### 3.3 收支规则（不变量）

- **INV-1**：收支方向唯一事实源是 `amountMicrocredits` 符号；`direction` 仅为派生过滤（`credit.service.ts:373-374`）。
- **INV-2**：`businessType` 不参与余额计算，不写入 `CreditLot`，不影响 FEFO 扣减与退款回收。余额永远由批次与流水推导（`docs/commerce-design.md:41`）。
- **INV-3**：写入时校验 `businessType → type` 绑定与金额符号一致，违反即拒（`AppError(40001, 400)` 同级）。
- **INV-4**：`businessType` 为展示/筛选维度，不改变 `C_END_LEDGER_TYPES`；`reserve` 中间态仍不向 C 端暴露。
- **INV-5**：`reason`/`note` 保留原语义（人工备注、系统说明），**不得**再作为业务判定输入。
- **INV-6（C 裁定）**：`amount` 为任意非零整数（微积分口径换算），**不约束为 ±10**；示例值不进入校验。
- **INV-7（裁定 I）**：扣费类业务类型**只有 `creative_image` 一个**，判定依据是模态，不得由 `capabilityId`、模型名或 `scene` 字符串硬编码判定。
- **INV-8**：`businessType` 在**扣费发起侧**计算并随 `WalletEntryMeta` 落库；`projectEntry()` 只透传，不做推导。

### 3.4 历史数据兼容（E 已采纳：读时 fallback，不回写）

1. `businessType` 非空 → 直接使用；
2. `type` 命中唯一映射（`expire → credit_expire`、`purchase → purchase`）→ 用该值；
3. `type` 一对多（`grant` / `consume` / `admin_adjust`）→ `other`，展示层降级为 `type` 文案；
4. 未知 `type` → `other`，前端原样显示 `type`（沿用 `admin/credits/constants.ts:5` 约定）。

> 不做 backfill 迁移，避免触碰只追加流水表的约束。历史 `consume` 因无模态信息，统一落 `other` 并显示「生成消耗」——可接受的降级，不猜测归属。

### 3.5 新用户赠送实施方案（D/J 已裁定）

| 项 | 决策 | 说明 |
|---|---|---|
| 积分数量 | **100 积分** | 裁定 J |
| 有效期 | **永久有效**（`validDays = 0` / `expireAt` 为空） | 裁定 J；与 `credit.service.ts:422`「`validDays=0` 或未指定 → 永久有效」一致，FEFO 排最后 |
| 落点 | `auth.service.ts:61` `register()`，user 创建（`:119`）之后 | 与欢迎消息同位置：`auth.service.ts:129-138` |
| 语义 | **自然注册即赠**（不依赖邀请关系） | 与 `InviteRewardRule.triggerOn`（`schema.prisma:1098-1099`，已预留 `register` 但仅实现 `first_pay`）区分 |
| 配置 | 新增单行规则（`id='default'`：`credits` / `enabled`），`validDays` 留空表示永久 | 参照 `CheckinRule`（`schema.prisma:1127`）单行配置范式 |
| 幂等 | `referenceKey = new-user-gift:${userId}` | 与现有 `credit-grant:*` 键空间不冲突（`credit.service.ts:428`） |
| 事务 | **注册事务外同步调用**，失败只记日志 + 告警，不回滚注册 | 与 welcome 通知同款取舍（`auth.service.ts:129`）：注册是核心链路，积分系统故障不得阻塞注册 |
| 补偿 | 后台「积分调整」入口人工补发（已有能力） | 不新建补偿任务 |
| 业务类型 | `new_user_gift` | 首次写入该枚举值 |

**默认处理（如需调整请提出）**：被邀请注册的用户**只发 `invite_reward`，不再发 `new_user_gift`**，避免同一用户拿两份注册礼。依据：邀请奖励已含「被邀请人」份额（`marketing.service.ts:1725-1735`）。

> **[财务提示]** 永久有效的新用户赠送会形成不可回收的积分负债（不同于 30 天会员积分的自动清退）。当前单笔 100 积分、无有效期，建议在后台保留「累计已发放 / 未消耗」统计口径，供后续调整赠送量时评估成本；不影响本次契约。

---

## 4. 接口契约

### 4.1 `GET /credits/ledger`

| 参数 | 类型 | 现状 | 变更 |
|---|---|---|---|
| `limit` / `offset` | number | 已有，上限 200 | 不变 |
| `type` | string | 7 值白名单 | 不变 |
| `direction` | `income \| expense` | 已有 | 不变 |
| **`businessType`** | string | — | **新增**，10 值白名单；未知值 → `40001 / 400`；空值不过滤 |

- 组合语义：`businessType` 与 `type` 取**交集**，与 `direction` 取 `AND`。
- `total` 必须按同一 `where` 统计（`credit.service.ts:376-384` 的 `findMany` + `count` 保持一致），否则筛选后页码错位。

### 4.2 响应体契约 diff

`CreditLedgerPage` 结构不变；`items[]` 每项新增 1 个字段：

```ts
/** 业务类型；历史流水由 fallback 推导，恒不为 undefined */
businessType: CreditBusinessType;
```

其余字段名称、类型、可空性**一律不变**。

**【G 裁定｜多返回字段不显示】** `projectEntry()` 实际多返回 `userId`、`operatorId`，两处前端类型均未声明。裁定：**不展示、不扩大契约、不新增到 C 端类型**；后台 `operatorId` 已在 `AdminCreditLedgerRow`（`admin-support.ts:269`）声明并可能用于审计，**保持投影返回不删除**（删除属额外变更，不在本批）。C 端视图不渲染这两个字段。

### 4.3 后台接口

`GET /admin/credits/:userId/ledger`（`docs/commerce-design.md:295`）同步支持 `businessType` 筛选并下发该字段，共用同一份 `projectEntry()`，避免两端口径分叉。

### 4.4 错误码

沿用 `AppError(40001, ..., 400)`，文案格式对齐 `未知积分流水类型：${type}`。

---

## 5. 前端筛选与展示口径

### 5.1 筛选交互（F 已采纳方案 B，分两批）

| 方案 | 做法 | 裁定 |
|---|---|---|
| A | 全部业务类型并入现有单 `Select`（层级混杂） | ❌ |
| B | 双 `Select`：类型筛选 + 业务类型筛选 | ✅ **采纳** |
| C | 仅展示不筛选 | ⚠ 降级备选 |

**分两批落地**：第 1 批只落「展示 + 接口字段」；第 2 批再加第二个 `Select`（需同步扩展 `hooks.ts:43-60` 翻页与 `:94-102` 筛选切换逻辑，避免翻页丢失业务类型条件）。

### 5.2 文案单一来源

`BUSINESS_TYPE_LABEL` / `BUSINESS_TYPE_OPTIONS` 置于 `credits/constants.ts`（该目录约定的常量唯一入口）；后台 `admin/credits/constants.ts` 复用同一份导出，**消除 D2 分叉**。

### 5.3 展示优先级

```
业务类型文案 > 类型文案
```

- 「类型」列主行：`BUSINESS_TYPE_LABEL[businessType]`；
- 兜底：`businessType === 'other'` 时显示 `LEDGER_LABEL[type]`；
- 不新增物理列：现 6 列 + `scroll={{ x: 850 }}`（`CreditsLedgerPanel.tsx:175`）已接近截断阈值（该文件 `:31-33` 记录过一次截断事故），业务类型作副行可避免 `scroll.x` 继续膨胀；
- 窄屏 `CreditsLedgerList.tsx:23-28` 同口径，保持两行结构；
- `reason` 列与 `ledgerRemark()` 逻辑**不动**。

### 5.4 金额与颜色

沿用 `amount >= 0` 判正负（`CreditsLedgerPanel.tsx:88`、`CreditsLedgerList.tsx:25`），显示 `+N` / `-N`，沿用 `is-plus` / `is-minus`。属积分收支而非行情，不涉及涨跌红绿约定。

---

## 6. 裁定结论汇总

| 编号 | 事项 | 裁定 |
|---|---|---|
| A | 落库字段 | ✅ 新增独立列 `businessType` + 索引 |
| B | 「连续签到奖励」重复 2 次 | ✅ **笔误重复**，实际 4 条流水 / 4 种业务类型 |
| C | `+10 / -10` 对应关系 | ✅ **示例数据**，契约不约束金额；任意非零整数 |
| D | 新用户赠送 | ✅ **新增**注册即赠发放点（§3.5） |
| E | 历史流水 | ✅ 读时 fallback，不回写 |
| F | 筛选交互 | ✅ 双 `Select`，分两批落地 |
| G | 多返回字段 | ✅ **不显示**：不扩契约、不改投影、C 端不渲染 |
| H | 文案口径 | ✅ **按新文案**：积分过期 / 创意生图扣费 / 连续签到奖励 / 新用户赠送 |
| I | AI修图、AI视频扣费分类 | ✅ **全部归 `creative_image`**；扣费类业务类型仅 1 个，按模态判定 |
| J | 赠送参数 | ✅ **100 积分 / 永久有效**；被邀请注册只发邀请奖励（默认） |

**无剩余阻塞项**，可进入实施。

按既有约定：每批结束停下等待确认；非上游语义的新增扩展须标记【新增扩展·非上游语义】并登记。

---

## 7. 落地影响面（**待批准后实施，本次未改动任何文件**）

| 批次 | 层 | 文件 | 改动性质 |
|---|---|---|---|
| 1 | Schema | `backend/prisma/schema.prisma`（`CreditLedgerEntry`） | 新增列 + 索引 + 迁移 |
| 1 | 钱包 | `credit-wallet.service.ts`（`WalletEntryMeta`） | meta 增 `businessType` |
| 1 | 服务 | `credit.service.ts`（`grant`/`consume`/`expireLots`/`ledgerOf`/`projectEntry`） | 写入、校验、筛选、投影 |
| 1 | 扣费侧 | `billing.service.ts`（`:270,342` 取模态）、`credit-wallet` 调用点 | 模态 → `creative_image` |
| 1 | 其他触发点 | `marketing.service.ts`、`membership/`、`orders/` | 各发放点传业务类型 |
| 1 | 控制器 | `credits.controller.ts` + 后台 credits 控制器 | 新增查询参数 |
| 1 | 前端 | `types/admin-console.ts`、`lib/api.ts:350-363` | 类型 + 参数 |
| 1 | 前端页面 | `credits/constants.ts`、`CreditsLedgerPanel.tsx`、`CreditsLedgerList.tsx` | 文案常量 + 展示优先级 |
| 2 | 前端筛选 | `credits/hooks.ts`、`credits/utils.ts` | 第二筛选维度 |
| 3 | 新用户赠送 | `schema.prisma`（新规则表）、`auth.service.ts`、发放服务 | **新增发放点**（100 积分 / 永久） |
| — | 测试 | `credit.service.spec.ts`、`credits-modules.test.ts`、`billing.service.spec.ts` | 枚举校验、模态映射、text/audio 例外、fallback、分页 |

---

## 8. 验收门禁（**需授权后执行**）

`tsc` → `vitest`（含上述三个 spec）→ `build` → `smoke` → `route-baseline`（确认 `/credits/ledger` 契约 diff 仅新增字段）→ `e2e`（筛选/翻页/窄屏）→ `mutation`（未知 `businessType` 返回 400、方向一致性校验不可绕过、text/audio 不得标为 `creative_image`）。

---

## 附录 A · 与用户清单逐项对账

| 输入项 | 契约归属 | 结论 |
|---|---|---|
| 时间 `2026-11-14 08:57:01` | `createdAt` | 已有；单条时间对应 4 条流水需各自时间，实际以库内 `createdAt` 为准 |
| 收入 / 支出 | `amount` 符号派生，`direction` 查询参数 | 不变；**不由业务类型决定** |
| 连续签到奖励（原列 2 次） | `checkin_streak` → `grant` | 笔误，**计 1 条** |
| 积分过期 | `credit_expire` → `expire` | 文案改「积分过期」 |
| 创意生图扣费 | `creative_image` → `consume` | 覆盖电商生图 / AI修图 / AI视频三组共 17 个能力；文案「创意生图扣费」 |
| 新用户赠送 | `new_user_gift` → `grant` | **新增**触发点；100 积分 / 永久有效 |
| `+10 / -10 积分` | `amount`（积分口径） | **示例值**，不构成约束 |
