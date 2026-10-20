# 完整商业运营后台系统 · 总体设计

货觉AI ｜ 2026-10-19 ｜ 状态：待裁定（未动代码）

**文档层级**：本文是**后台设计附件**。后台实现依据为 `docs/admin-prd.md`（后台管理系统需求）；整站产品需求见 `docs/prd.md`。本文负责：全域地图、补齐的 7 个缺失域、合规专项、总表、RBAC、总路线图。
分域细节见 `docs/admin-console-design.md`（运营域）、`docs/commerce-design.md`（交易域）、`docs/gap-analysis.md`（缺口取证）。

---

## 0. 结论先行

### 0.1 现状判定

| 项 | 状态 |
|---|---|
| 后台代码 | **零**。`grep admin/运营` 全库无命中；`global.css` 无任何 `adm-*` 规则 |
| 已出设计 | 2 份文档，共 11 个模块（7 运营 + 4 交易） |
| 缺口 | 7 个商业运营必备域 + 1 项**已生效的监管合规硬要求** |

### 0.2 三条最高优先级裁定

| 排名 | 裁定 | 理由 |
|---|---|---|
| **P0-1** | **AIGC 内容标识必须做，且排在所有交易功能之前** | 《人工智能生成合成内容标识办法》**2025-09-01 已施行**（四部门：网信办/工信部/公安部/广电总局），配套强制性国标《网络安全技术 人工智能生成合成内容标识方法》同步实施。本项目 15 项能力全部产出 AI 生成图片，**当前零标识**。这是监管义务，不是产品偏好 |
| **P0-2** | 全域**统一 RBAC 三角色**，不做单一 admin 布尔位 | 商业运营后台的真实分工是「运营 / 客服 / 财务」。若只做 `role=admin`，财务退款权限会和删用户权限绑死，出事无法追责 |
| **P0-3** | 交易域维持「账本优先」顺序不变 | `commerce-design.md` K1→K4 顺序不可打乱：支付可插拔，账本错了后面全错 |

### 0.3 全域模块地图（18 个）

| 域 | 模块 | 状态 |
|---|---|---|
| **合规** | 合规中心（AIGC 标识 + 内容安全 + 留痕） | **新增 P0** |
| **交易** | 商品管理 / 订单管理 / 支付流水 / 财务概览 | 已设计（commerce K2-K4） |
| **资产** | 积分账本（批次 + 流水 + 人工调整） | 已设计（commerce K1/K4） |
| **运营** | 平台概览 / 用户管理 / 项目素材 / 任务监控 | 已设计（admin A2-A3） |
| **增长** | 营销中心（优惠券 / 活动 / 邀请分销 / 签到） | **新增** |
| **触达** | 消息中心（站内信 / 公告 / 模板） | **新增** |
| **服务** | 工单中心（用户反馈 / 售后 / 退款申请） | **新增** |
| **渠道** | ~~分销与席位（企业版 / 代理 / 成员配额）~~ | ❌ **本期不做（D5）** |
| **分析** | 数据分析（漏斗 / 留存 / LTV / ROI） | **新增** |
| **配置** | 能力与通道 / 系统设置 / 操作审计 | 已设计（admin B1-B2） |
| **组织** | 角色权限（RBAC 矩阵） | **新增 P0** |

---

## 1. 合规中心（P0-1 · 新增）

### 1.1 监管事实

| 事实 | 来源 |
|---|---|
| 《人工智能生成合成内容标识办法》2025-03-14 发布，**2025-09-01 施行** | 中国政府网 / 央广网 |
| 服务提供者**必须**为生成的文本/音频/图片/视频添加**显式标识** | 办法第 6 条 |
| 在**下载、复制、导出**功能中，文件中**必须含**符合要求的显式标识 | 办法第 6 条 |
| **必须**在生成合成内容的**文件元数据**中添加**隐式标识** | 办法第 7 条 |
| 隐式标识字段名**必须包含 "AIGC"**，含：生成确认状态、服务提供者名称/编码、内容编号、数字签名或哈希校验值 | 配套强标《标识方法》 |
| **任何组织和个人不得恶意删除、篡改、伪造、隐匿**标识，**不得为他人实施上述行为提供工具或服务** | 办法第 12 条 |

**今天是 2026-10-19，办法已施行 13 个月。** 本项目 15 项能力全部产出 AI 生成图片，当前 `backend/src` 无任何标识代码（已 grep 核实）。

### 1.2 一个必须正视的次生风险

本项目 `capability.registry.ts:480` 有能力 **`remove_watermark`（去除水印）**，参考站也有。对照办法第 12 条「不得为他人实施上述恶意行为提供工具或者服务」——该能力存在被用于**剥离他人图片上的 AIGC 标识**的合规敞口。

这不是产品功能问题，是**运营侧必须能管控**的问题：需要开关、降权、留痕。

### 1.3 功能设计

| 能力 | 说明 | 优先级 |
|---|---|---|
| **显式标识注入** | 生成产出图在导出前叠加标识（角标文字 + 半透明底）。位置可配（右下/左下/中心），默认右下，字号随图宽比例自适应 | P0 |
| **隐式标识写入** | 在 PNG `tEXt` / JPEG `COM(EXIF)` 段写入：`AIGC=1` / `AIGC-Provider=货觉AI` / `AIGC-ContentId=<assetId>` / `AIGC-Timestamp` / `AIGC-Signature=<sha256(assetId+secret)>` | P0 |
| **下载/导出校验** | 所有下载、复制、导出路径统一走同一 `stampAsset()` 出口，**禁止绕过**。CI 加断言：所有导出响应必须带标识 | P0 |
| **界面声明** | 结果区显式标注「本图由 AI 生成」，满足办法对交互场景界面的要求 | P0 |
| **去水印能力管控** | 后台可对 `remove_watermark` 做：正常开放 / 降权（0 积分但限次）/ 关闭；每次调用留痕（用户、时间、输入图哈希） | P0 |
| **内容安全送审** | 生成产出可选接第三方内容安全 API（图片涉黄/涉政/广告法违禁词）。未接入时**明确显示"未接入"**，不做假审核 | P1 |
| **违规处置** | 命中后可下架素材、冻结用户、记录处置单 | P1 |
| **标识合规自检** | 后台一键巡检：抽样产出图，检查显式标识是否存在 + 隐式字段是否完整，输出报告 | P1 |
| **留痕与举证** | `ComplianceLog` 记录每次标识注入、人工管控、内容送审结果 | P0 |

### 1.4 数据模型

```prisma
model AigcStamp {
  id          String   @id @default(cuid())
  assetId     String   @unique
  visibleMark Boolean  @default(true)   // 显式标识是否已注入
  metadata    String   // 隐式标识 JSON 快照
  signature   String   // sha256(assetId + stampSecret)
  injectedAt  DateTime @default(now())

  @@index([injectedAt])
}

model ComplianceLog {
  id         String   @id @default(cuid())
  userId?    String
  assetId?   String
  action     String   // stamp | capability_gate | content_review | takedown | freeze
  targetType String
  targetId   String
  detail     String   // JSON
  actorId    String?  // 人工操作人；系统自动操作为 null
  createdAt  DateTime @default(now())

  @@index([action])
  @@index([createdAt])
}
```

### 1.5 实施位置

`backend/src/compliance/`，`stampAsset(assetId, buffer)` 在 `generate.service.ts` 写盘前调用（现约 `:100-110` 处）。`STAMP_SECRET` 走环境变量，**不进 DB、不进前端**。

> 若法务判定「本平台属办法所指的深度合成服务提供者」，显式+隐式双标识是强制项；若判定不适用，仍建议保留（成本极低，且是平台信誉资产）。**建议先做法务确认，但工程上按强制项排期。**

---

## 2. RBAC 角色权限（P0-2 · 新增）

### 2.1 三角色设计

推翻 `admin-console-design.md` §5 的两级 `role: user|admin`，改为：

| 角色 | code | 定位 |
|---|---|---|
| 平台管理员 | `admin` | 全部权限，含系统配置与角色管理 |
| 运营 | `operator` | 用户/项目/素材/任务/营销/消息，不可碰财务与系统配置 |
| 财务 | `finance` | 商品/订单/支付/退款/积分调整，**只读**用户，不可删数据 |

**为什么必须拆**：财务能退款 = 能改钱，运营能删用户 = 能毁数据。这两种权限绑在一个布尔位上，出了事无法区分是谁做的，审计日志也失去意义。

### 2.2 权限矩阵

`✎`写 `◐`只读 `—`无

| 模块 | admin | operator | finance |
|---|:---:|:---:|:---:|
| 平台概览 | ◐ | ◐ | ◐ |
| 用户管理 | ✎ | ◐ | — |
| 项目 / 素材 | ✎ | ✎ | — |
| 任务监控 | ✎ | ◐ | — |
| **合规中心** | ✎ | ◐ | — |
| 商品管理 | ✎ | — | ✎ |
| 订单管理 | ✎ | — | ✎ |
| 支付流水 / 财务概览 | ✎ | — | ✎ |
| 积分账本 | ✎ | — | ✎ |
| 营销中心 | ✎ | ✎ | — |
| 消息中心 | ✎ | ✎ | — |
| 工单中心 | ✎ | ✎ | ◐ |
| ~~分销与席位~~ | — | — | — | ❌ D5 本期不做 |
| 数据分析 | ◐ | ◐ | ◐ |
| 能力与通道 | ✎ | — | — |
| 系统设置 | ✎ | — | — |
| 角色权限 | ✎ | — | — |
| 操作审计 | ◐ | — | ◐ |

### 2.3 数据模型与强制规则

```prisma
model AdminRole {
  id          String   @id @default(cuid())
  code        String   @unique   // admin | operator | finance
  name        String
  permissions String   // JSON 数组: ["user.write","order.refund",...]
  builtIn     Boolean  @default(true)  // 内置角色不可删
}

model User {
  role String @default("user")   // user | admin | operator | finance
  // ...
}
```

| 规则 | 实现 |
|---|---|
| 兜底默认拒 | `AdminGuard` 校验 `permission in role.permissions`，未命中即 403 |
| 权限粒度 | `<模块>.<动作>` 字符串，如 `user.write` / `order.refund` / `credit.adjust` / `compliance.gate` |
| 不可自我提权 | 改他人角色时禁止高于自己的角色（`admin` 除外），防 `operator` 把自己提成 admin |
| 最后一个 admin | 禁止降级/删除，服务层断言 + 409 |
| 高危动作二次确认 | `order.refund` / `user.delete` / `credit.adjust` / `settings.write` 前端强制二次确认并写审计 |

---

## 3. 营销中心（新增）

### 3.1 模块

| 能力 | 说明 | 优先级 |
|---|---|---|
| 优惠券 | 满减 / 折扣 / 固定额；发放范围（全部/指定 SKU/新用户）；使用条件、有效期、每人限用、总量；核销走 `Order.couponId` | P1 |
| 限时活动 | 商品限时价（覆盖 `Product.priceCents`）、限时免费能力（复用 `commerce` §4.4 `freeWindowEnd`） | P1 |
| 邀请分销 | 邀请链接带 `inviteCode`，被邀请人注册后绑定关系；奖励规则（邀请人得 X 积分 / 被邀请人得 Y） | P1 |
| 签到 | 每日签到得积分，连签加成；`CreditLot.source = reward` | P2 |
| 渠道追踪 | UTM 参数 → 落地 → 注册 → 首单归因 | P2 |
| 弹窗与公告位 | 首页/工作台浮层，按人群与时间投放 | P2 |

### 3.2 与现有页面的对接点

`InvitationsPage.tsx:29-45` 已复刻参考站的邀请三步版面，且当前是**诚实降级**（不提供积分奖励，`InvitationsPage.tsx:72,107` 明示）。营销中心落地后，该页改为真实邀请码 + 奖励数据，**版面不用改**，只换数据源与按钮行为。这是低成本高价值的对接点。

`PromoBar.tsx` 当前是静态卖点条（`PromoBar.tsx:14-16` 注释明说"不做虚假倒计时"）。活动配置完成后，此处改为真实活动位，**倒计时数据必须来自 DB**，不得前端自减。

### 3.3 数据模型（新增 4 表）

```prisma
model Coupon {
  id, code(unique), type /* full_cut|discount|fixed */, value, thresholdCents,
  scope /* all|product */, productIds /* JSON */, totalCount, usedCount,
  validFrom, validTo, perUserLimit, status /* on|off */
}

model InviteRelation {
  id, inviteCode, inviterId, inviteeId(unique), boundAt, rewardStatus /* pending|granted */
}

model InviteRewardRule {
  id, inviterCredits, inviteeCredits, valid
}

model Campaign {
  id, name, type /* limited_price|limited_free|popup */, payload /* JSON */,
  startAt, endAt, status /* draft|active|ended */, audience /* JSON */
}
```

---

## 4. 消息中心（新增）

| 能力 | 说明 | 优先级 |
|---|---|---|
| 站内信 | 系统通知 / 订单支付成功 / 积分到账 / 任务失败退积分 / 违规警告；未读数角标 | P1 |
| 公告 | 全站公告弹窗与公告页；可定时发布与撤回 | P1 |
| 模板 | 消息模板（标题/正文/变量占位），后台可视化编辑 | P1 |
| 触发器 | 事件 → 消息（`order.paid` → 站内信 + 后续可接邮件/短信） | P1 |

**数据模型**：`Notification`（`userId / type / title / body / payload / readAt / createdAt`）+ `Announcement` + `MessageTemplate`。

**明确不做**：邮件发送、短信、微信推送（无触达凭据，且外部通道需单独接入）。站内信是零依赖的第一层。

---

## 5. 工单中心（新增）

| 能力 | 说明 | 优先级 |
|---|---|---|
| 用户报障 | 用户提交工单（关联任务 ID / 素材 ID / 订单号），图文描述 | P1 |
| 处理流转 | 状态机 `open → processing → resolved / closed`；指派处理人；内部备注（用户不可见） | P1 |
| 退款申请 | 用户发起退款申请 → 财务在订单模块处理（工单只做流转，不直接改钱） | P1 |
| SLA | 首响时限（按优先级 P0-P2），超时高亮 | P2 |

**与订单的边界**：工单是**沟通与记录**通道，财务动作一律跳转到订单模块执行，避免两处都能改钱。

---

## 6. 分销与席位（❌ 本期不做 · D5 已定）

> **2026-10-19 更新**：PRD 决策 D5「个人轨先行，团队轨延后」已裁定 —— **本节全部内容移出本期范围**。`M16` 批次取消，`Organization` / `OrganizationMember` / `Agent` / `CommissionRecord` 四表不建，`User` 不加 `orgId`。
> **重启条件**：个人轨跑通商业闭环 + 有真实付费数据 + 算出个人客户 LTV 后，用数据而非假设决策。

以下内容仅作日后参考，本次不实现。

面向机构 / 工作室 / 独立创作者。

| 能力 | 说明 | 原优先级 |
|---|---|---|
| 企业席位 | 购买 N 个成员席位，成员共享积分池；成员数上限校验 | P2 |
| 成员管理 | 主账号邀请成员、分配角色、回收席位 | P2 |
| 代理分销 | 代理商账号 + 下级客户 + 分成比例 | P3 |
| 分成结算 | 对账单 | P3 |

**未来重启时的依赖**：`User` 加 `orgId` + `Organization` 表，会把项目从单租户改为多租户，**所有现有查询都要加租户过滤**——这是一次性大改，故重启时需单列独立批次，不与功能批次混做。

---

## 7. 数据分析（新增）

| 看板 | 指标 |
|---|---|
| 增长 | 新增注册 / 激活（首单或首次生成）/ 渠道来源分布 |
| 转化 | 落地页 → 注册 → 首次生成 → 首次付费，四步漏斗 |
| 留存 | 次日 / 7 日 / 30 日留存（按注册 cohort） |
| 收入 | GMV / 实收 / 退款 / 客单价 / ARPU |
| 积分 | 发放量 / 消耗量 / 沉淀量 / 即将过期量 |
| 成本 | 每次生成的通道成本（`provider=gateway` 时按 `GATEWAY_MODEL` 计费）、毛利 = 实收 − 通道成本 |
| 能力 | 各能力使用量 / 成功率 / 消耗积分占比 |

**实现约束**：`TaskCapabilityPrice` / `CreditLedger` 上线后这些指标才能算准。在此之前只做用户/任务类指标，**收入与毛利留空并标注"待交易域上线"**，不编数。

---

## 8. 全量数据模型总表

### 8.1 已有 4 表
`User` / `Project` / `Asset` / `GenerationTask`

### 8.2 交易与资产（5 表，commerce 设计）
`Product` / `Order` / `OrderItem` / `CreditLot` / `CreditLedger`（~~`ProductCapabilityPrice`~~ D7 已删）

### 8.3 合规（2 表，本设计 §1.4）
`AigcStamp` / `ComplianceLog`

### 8.4 权限（1 表，本设计 §2.3）
`AdminRole`

### 8.5 营销（4 表，本设计 §3.3）
`Coupon` / `InviteRelation` / `InviteRewardRule` / `Campaign`

### 8.6 消息（3 表，本设计 §4）
`Notification` / `Announcement` / `MessageTemplate`

### 8.7 工单（2 表，本设计 §5）
`Ticket` / `TicketMessage`

### 8.8 渠道（4 表，本设计 §6，**❌ 本期不建 · D5**）
`Organization` / `OrganizationMember` / `Agent` / `CommissionRecord`

### 8.9 配置与审计（3 表，admin 设计）
`AdminAuditLog` / `SystemSetting`（~~`CapabilityOverride`~~ D7 暂缓建表）

**合计 29 表 → D5 后 25 表 → D7 后实建 21 表**（团队版 4 表不建；`ProductCapabilityPrice` / `CapabilityOverride` 暂缓）。

### 8.10 关键字段扩列汇总

| 模型 | 新增字段 | 来自 |
|---|---|---|
| `User` | `role`(3 值) / `status` / `lastLoginAt` | admin §6.1 + 本设计 §2.1 |
| `Asset` | `status`(visible/hidden) | admin §4.3 |
| `GenerationTask` | `creditCost` | commerce §7.3 |
| ~~`Order.couponId` / `campaignId`~~ | — | ❌ **D7 建议删除**：M11 营销是 P1，届时一并加 |

> **D5 单轨化裁定**：`Product` 不加 `audience`/`seats`；`CreditLot` 不加 `scope`；`User` **不加** `orgId`（过早抽象，当前无第二租户）。详见 PRD §3.5。

---

## 9. 全量 API 总表

前缀：`/api/v1/admin/*`（统一 `JwtAuthGuard + AdminGuard + 权限点校验`）

| 组 | 端点数 | 状态 |
|---|---:|---|
| 概览 `/admin/overview*` | 2 | 已设计 |
| 用户 `/admin/users*` | 7 | 已设计 |
| 项目 / 素材 `/admin/projects*` `/admin/assets*` | 4 | 已设计 |
| 任务 `/admin/tasks*` | 4 | 已设计 |
| 能力与通道 `/admin/capabilities*` `/admin/channel*` | 5 | 已设计 |
| 设置 `/admin/settings*` `/admin/storage` | 3 | 已设计 |
| 审计 `/admin/audit-logs` | 1 | 已设计 |
| 商品 `/admin/products*` `/admin/credit-prices*` | 5 | commerce |
| 订单 `/admin/orders*` | 4 | commerce |
| 支付 `/admin/payments*` `/admin/finance/*` | 2 | commerce |
| 积分 `/admin/credits*` | 4 | commerce |
| **合规** `/admin/compliance/*` | 6 | **新增** |
| **角色** `/admin/roles*` | 3 | **新增** |
| **营销** `/admin/coupons*` `/admin/campaigns*` `/admin/invites*` | 7 | **新增** |
| **消息** `/admin/notifications*` `/admin/announcements*` `/admin/templates*` | 5 | **新增** |
| **工单** `/admin/tickets*` | 3 | **新增** |
| **渠道** `/admin/orgs*` `/admin/agents*` | 5 | **新增 P2** |
| **分析** `/admin/analytics/*` | 4 | **新增** |

**合计约 74 个 admin 端点** + 11 个前台端点（commerce §8.1）。

---

## 10. 前台路由与页面增量

| 类型 | 新增 | 归属 |
|---|---|---|
| 后台页 | `pages/admin/` 20 个（概览/用户/项目/素材/任务/能力/设置/审计/商品/订单/支付/积分/合规/角色/营销/消息/工单/渠道/分析/财务） | 全部 |
| C 端页 | `CreditsPage`（积分明细）、`OrdersPage`（我的订单）、`CheckoutPage`（下单支付） | commerce |
| C 端改造 | `LandingPage` / `PackagesPage` 去硬编码价目；8 个工具页 `creditLabel` 改动态；`AppLayout` 顶导余额；`ToolSubmitBar` 余额不足态；`InvitationsPage` 接真实邀请码；`PromoBar` 接真实活动 | commerce + 营销 |
| C 端合规 | 结果区「本图由 AI 生成」声明 + 导出统一走 `stampAsset` | 本设计 §1.3 |

---

## 11. 统一设计规范

后台有 20 个页面，必须锁死规范，否则会重演"硬编码 hex 342 处"的老问题。

| 层 | 规范 |
|---|---|
| 外壳 | 单一 `AdminLayout`（antd `Layout`：`Sider` 240px 固定 + `Header` 56px + `Content`）。**禁止**复用 `AppLayout`/`SideRail`/`PromoBar`（C 端语义） |
| 侧栏 | 分组折叠菜单；图标 lucide 20px；选中态 `var(--brand)` + `var(--brand-bg)`；底部显示当前管理员角色 |
| 列表页 | **统一结构**：页头（标题 + 主操作）→ 筛选条 → 表格 → 分页。表格统一 `rowKey="id"`、`size="small"`、分页 `showSizeChanger` |
| 详情 | 一律**抽屉**（`Drawer` 720px），不跳独立路由（减少路由数，便于保留筛选态） |
| 危险操作 | `Popconfirm` + 明确文案（写明"将删除 N 条"），财务类动作额外要求输入确认 |
| 空态 | antd `Empty` + 一句真实说明，**不留空白** |
| 加载 | 表格 `loading` prop；骨架屏仅首屏 |
| 颜色 | **只用 `global.css` 已有 token**。新增 `adm-*` 样式一律 `var(--token)`，禁裸 hex |
| 数字 | 金额统一 `¥` + 两位小数（内部存分，展示层格式化）；积分整数千分位 |
| 时间 | 统一 `YYYY-MM-DD HH:mm`；相对时间仅在列表辅助列 |
| 导出 | 列表右上角「导出 CSV」统一走同一 hook（游标分页导出，避免大表 OOM） |
| 响应式 | 后台最小宽度 1280，窄于则横向滚动；不做移动端适配（运营用桌面） |

---

## 12. 总路线图

统一编号，跨三份文档。

| 批次 | 内容 | 前置 | 风险 |
|---|---|---|---|
| **M1** | **合规标识**：显式叠加 + 隐式元数据 + 导出统一出口 + `AigcStamp`/`ComplianceLog` + 结果区声明 | 无 | **低**（不改数据结构语义，纯增量） |
| **M2** | **权限底座**：schema 扩列（User.role/status + AdminRole + 29 表全量 push）+ `AdminGuard` + 权限点校验 + `AdminLayout` 空壳 + `seed-admin.ts` + `RequireAdmin` | M1 | 中 |
| **M3** | **合规中心页** + 去水印能力管控 + 标识自检巡检 | M2 | 低 |
| **M4** | 平台概览 + 用户管理 | M2 | 低 |
| **M5** | 项目 / 素材 / 任务监控 | M2 | 低 |
| **M6** | **积分账本**（`CreditLot`/`CreditLedger` + FEFO + 生成扣费与退款） | M2 + **定价裁定** | 中 |
| **M7** | **商品**（SKU + 消耗价 + `GET /products` + 前端去硬编码） | M6 + **价目裁定** | 中 |
| **M8** | **订单 + 沙箱支付**（状态机 + 幂等 + `PAYMENT_PROVIDER`） | M7 | 中 |
| **M9** | **交易后台 4 页**（商品/订单/支付/积分） | M8 | 低 |
| **M10** | 角色权限页 + 审计页 | M2 | 低 |
| **M11** | 营销中心（优惠券 / 活动 / 邀请分销） | M8 | 中 |
| **M12** | 消息中心 + 工单中心 | M2 | 低 |
| **M13** | 数据分析 | M9 | 中 |
| **M14** | 能力与通道 + 系统设置 | M2 | 低 |
| **M15** | 真实微信/支付宝通道（需商户号） | M8 | 高（外部依赖） |
| ~~**M16**~~ | ~~多租户 + 席位 + 分销~~ | — | ❌ **D5 已取消** |

### 12.1 关键路径

```
M1 合规 ──> M2 权限底座 ──┬──> M4/M5 运营后台
                          ├──> M6 积分 ──> M7 商品 ──> M8 订单支付 ──> M9 交易后台 ──> M13 分析
                          ├──> M3 合规页 / M10 权限页 / M12 消息工单
                          └──> M14 能力设置
```

### 12.2 每批闸口

`prisma:push` → `npm run build` → `npm run typecheck`（前端）→ 对应冒烟脚本 → 越权用例（低权限 token 打高权限接口必须 403；合规批次加"导出文件必含标识"断言）。

新增冒烟脚本：`smoke-compliance.js`（标识完整性）、`smoke-credits.js`（扣费→退款→并发不超扣）、`smoke-orders.js`（幂等下单 + 状态机）。

---

## 13. 未决项

### 13.1 阻塞项（不定无法开工）

| # | 问题 | 建议 |
|---|---|---|
| 1 | **AIGC 标识是否按强制项排期？** | 建议是。法务确认可并行，但工程按强制做 |
| 2 | **法务判定本平台是否属办法所指"深度合成服务提供者"？** | 15 项能力均产出生成合成图片，**高度可能是**。需用户或法务确认 |
| 3 | **单能力消耗价**（commerce 冲突 A） | 10 / 20 / 0 |
| 4 | **唯一价目源**（commerce 冲突 B） | `LandingPage` 实拍价 |
| 5 | 角色是否就 `admin`/`operator`/`finance` 三档？ | 是 |

### 13.2 非阻塞项

| # | 问题 | 建议 |
|---|---|---|
| 6 | 新用户注册送多少积分 | 100（够生成 10 张图） |
| 7 | 订单超时时长 | 15 分钟 |
| 8 | 退款退钱还是退积分 | MVP 只退积分；真实通道接入后再支持原路退 |
| 9 | 订阅 `monthly` 分月发放 MVP 是否实做 | 先只做 `once`，无调度器 |
| 10 | `remove_watermark` 默认开放还是降权 | 建议**随 D2 一并下架**（在 mock 名单 + 撞标识办法第 12 条）；若保留则 0 积分 + 限次 + 全量留痕 |
| 11 | ~~多租户是否本季度做~~ | ✅ **D5 已定：不做**，M16 取消 |

---

## 附录 · 本轮新增代码事实

| 事实 | 出处 | 影响 |
|---|---|---|
| 后端零 admin 代码 | `backend/src/**` grep | 20 页后台全新 |
| `global.css` 零 `adm-*` 规则 | 实测 | 后台样式全新，只许用已有 token |
| 无任何组织/租户/团队字段 | `schema.prisma` | 多租户需改全部查询 |
| 无 AIGC 标识代码 | grep `watermark\|metadata\|exif` | 合规缺口（§1） |
| 能力 `remove_watermark` 存在 | `capability.registry.ts:480` | 标识剥离敞口（§1.2） |
| `InvitationsPage` 已复刻版面但诚实降级 | `InvitationsPage.tsx:29-45,72` | 营销落地时版面零改动 |
| `PromoBar` 明示"不做虚假倒计时" | `PromoBar.tsx:14-16` | 接真实活动时不破坏该诚实约束 |
| `README.md` 无后台章节 | 实测 | 交付时需同步 README（CLAUDE.md 约定） |
| e2e 仅 `example.spec.ts` | `frontend/e2e` | 后台 E2E 需新建 |