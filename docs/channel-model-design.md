# 渠道与模型子系统整体移植方案（对齐 open-ai-canvas）

> 状态：已实施 —— P0 ~ P6 全部交付；旧 `src/providers/**`、`GATEWAY_*` 变量、`ModelCallLog` 写入方与后台 `/admin/model-config`、`/admin/model-channels` 已删除，`docs/model-architecture.md` 已按新层重写。真实厂商密钥连通性验收待在部署环境配好凭据后执行。
> 日期：2026-10-31
> 决策：**废弃本仓现有模型层，按 `open-ai-canvas` 全量移植，不做功能裁剪**
> 参考实现：`/Users/bright/github/open-ai-canvas`（Go 1.25 + Gin + GORM，MIT）
> 关联：`docs/model-architecture.md`、`docs/api-contract.md`、`docs/commerce-design.md`、`docs/testing.md`、`CLAUDE.md`

## 0. 本版取代上一版

上一版方案（「能力即逻辑模型、只补 `ChannelModel`、不做路由/插件/微积分/代理」）**整体作废**。被推翻的判断逐条列出，避免实现时两套思路混用：

| 上一版判断 | 本版决定 | 理由 |
| --- | --- | --- |
| 能力即逻辑模型，不复制 `LogicalModel / Revision / Route` | 原样复制三层，能力只做工作流定义 | 能力是表单与提示词，逻辑模型是可售 SKU；改价换线路不该发版，改能力文案不该动账单 |
| 用户扣费仍按能力积分价，`ChannelModelPriceTier` 只算成本 | 售价由「价格档 × 分组倍率 × 货币」决定 | 参考实现里价格档同时承载售价；拆成两套价会让「后台看到的价」与「实际扣费」再次分叉 |
| 不做用户自建渠道、代理路由、插件、加权路由 | 全部移植 | 渠道模型依赖协议插件；代理与自定义渠道属于渠道域 |
| 不做加权随机，只按 priority 顺序 | priority 硬分层 + 同层加权随机 | 故障切换、灰度与新线路放量都依赖这一层 |
| 积分为整数，不引入 microcredits | 全链路微积分（1 积分 = 1,000,000 微积分） | Token / 按秒计费必须小数级精度，整数积分会把差价抹平 |
| `ModelCallLog` 兼作尝试记录 | 独立 `RouteAttempt` + `ApiCallLog` | 一次任务可切换多条线路，观测与计费要对每次尝试独立归因 |
| P0–P3 渐进增强 | P0–P6 替换式交付，旧模型层直接删除 | 开发阶段不写兼容代码；两套调度器并存会产生无法解释的行为 |

## 1. 范围与边界

### 1.1 移植范围（模型域 1:1）

| 子域 | 内容 |
| --- | --- |
| 渠道 | 系统渠道 CRUD、复制、导出/导入、排序、凭证加密、请求头、代理解析、出站校验 |
| 渠道模型 | 多模型接入、能力与协议、上游模型键、能力配置、价格档、批量改价/删除、上游目录拉取与测试、排序 |
| 前台模型 | `LogicalModel / Revision / Route`、能力合同、默认参数、价格策略、归档、路由模拟 |
| 路由运行时 | 路由目录缓存、意图解析、能力匹配、priority 分层 + 加权、冷却、尝试状态机、故障切换 |
| 计费 | 微积分账户、预留/结算/退款、Token 与按秒计量、不确定订单人工核对、自动退款 |
| 用户分组 | 分组可见渠道、倍率、货币兑换、模型级覆盖、默认分组 |
| 协议与插件 | `yingce.plugin/v2` 清单、声明式表达式 DSL、内置适配器、插件包安装/启停、内置插件目录 |
| 观测 | `ApiCallLog`、渠道模型健康（24h/7d、P95、最近样本）、财务分析 |
| 代理 | 系统渠道中转、短路径中转、用户自定义渠道中转（SSRF 防护、并发槽、限流、流式透传） |

### 1.2 不移植（非模型域）

以下属于参考站的产品域，与本项目定位无关或已有实现；**不移植不等于在模型域内裁剪功能**：

- 画布 / 短剧 / 工作流编辑器 / 智能体（`agent_*`）/ 技能策展；
- 参考站的支付渠道、兑换码、邀请、签到、登录日志；
- 参考站的素材库、项目、皮肤、通知。

模型域依赖的**通用件**随模型域一并移植：出站 URL 校验（SSRF）、密钥加密、限流、微积分算术、任务租约与 worker（单实例：冷却、并发槽、目录版本均为进程内存 + DB 版本号）。

### 1.3 许可与署名

参考实现为 MIT（`LICENSE`，Copyright 2026 ddcat and Open AI Canvas contributors）。移植时：

1. `backend/src/model/` 与 `backend/plugins/` 各放一份 `NOTICE`，保留原始版权与许可文本；
2. 仓库根 `NOTICE` 增加「本项目的渠道与模型子系统移植自 open-ai-canvas（MIT）」；
3. 派生文件头保留来源说明（注释即可，不改上游语义）。

## 2. 目标架构

### 2.1 分层

依赖方向单向，禁止反向 import：

```
应用层（generate / prompt-tools / admin）
   ↓
任务准入与执行（admission / worker / executor / media recovery）
   ↓
统一模型层（catalog / quote / router / attempt / billing）
   ↓
厂商与渠道层（channel / channel-model / price-tier / user-group）
   ↓
协议层（protocol registry / manifest / expression / builtin adapters）
   ↓
基础设施（outbound / secret-cipher / microcredits / coordination）
```

### 2.2 目标目录（后端）

```
backend/src/model/
├── model.module.ts
├── catalog/
│   ├── route-catalog.service.ts        # 路由快照、TTL、版本失效
│   ├── catalog.service.ts              # 公开目录 / 可用性 / 分组投影
│   └── quote.service.ts                # 渠道模型报价 / 前台模型报价
├── intent/
│   ├── capability-spec.ts              # CapabilitySpec 类型与规范化
│   ├── capability-match.ts             # MatchCapability
│   └── model-intent.ts                 # 任务输入 → ModelRequestIntent
├── routing/
│   ├── router.service.ts               # ResolveLogicalModel / 候选池 / 加权
│   ├── price-tier.service.ts           # SKU 选择器与价格档匹配
│   ├── attempt.service.ts              # RouteAttempt 生命周期与故障切换
│   └── route-health.service.ts         # 冷却（进程内存）
├── channels/
│   ├── channel.service.ts
│   ├── channel-model.service.ts
│   ├── channel-model-catalog.service.ts
│   ├── channel-model-pricing.service.ts
│   ├── channel-order.service.ts
│   ├── channel-transfer.service.ts
│   └── channel-health.service.ts
├── logical-models/logical-model.service.ts
├── user-groups/user-group.service.ts
├── billing/
│   ├── billing-order.service.ts
│   ├── billing-coordinator.service.ts
│   └── credit-account.service.ts
├── protocol/
│   ├── registry.ts / manifest.ts / expression.ts / manifest-adapter.ts
│   ├── package.ts                      # 插件包解析与校验
│   └── builtin/*.ts                    # 内置协议适配器
├── plugins/plugin.service.ts
├── tasks/
│   ├── task-admission.service.ts
│   ├── task-worker.service.ts
│   ├── task-executor.service.ts
│   └── media-recovery.service.ts
├── proxy/
│   ├── system-proxy.controller.ts
│   ├── custom-relay.controller.ts
│   └── concurrency.service.ts
└── infra/
    ├── outbound.ts                     # ValidateOutboundURL / 代理
    ├── secret-cipher.ts                # AES-256-GCM
    └── microcredits.ts
```

现有 `backend/src/providers/**` 全目录删除，不保留别名或再导出。

### 2.3 请求时序（创建一次生成任务）

1. 客户端取目录：`POST /models/available`（带意图）→ 可用前台模型与价格档。
2. 客户端选模型并报价：`POST /models/:id/quote` → `amountMicrocredits`。
3. 提交：`POST /generate` 携带 `logicalModelId` + 能力参数。
4. 服务端重新解析（**不信客户端的模型/渠道/价格**）：`ResolveLogicalModel` → 选线路 → 选价格档 → 构造账单。
5. 预留：`ReserveBillingOrder`（available → reserved），与任务创建同一事务。
6. worker 领取任务 → 创建/恢复 `RouteAttempt` → 派发上游。
7. 成功 → 下载产物 → `SettleBillingOrder`；失败 → 按 `dispatchState` 决定切换线路或终态退款。

## 3. 数据模型

### 3.1 新增表（Prisma）

命名与参考实现对齐；主键统一 `String @id @default(cuid())`（参考实现的可读前缀 ID 不移植，排序依赖显式 `sortOrder` 与 `attemptNumber`）。

| 表 | 关键字段 | 索引 / 约束 |
| --- | --- | --- |
| `ModelChannel`（重建） | `scope`(system/user)、`enabled`、`name`、`sortOrder`、`baseUrl`、`apiKey`(密文)、`secretKey`(密文)、`apiFormat`、`concurrencyLimit`(0=用全局)、`proxyUrl`、`modelsJson`、`retiredModelsJson`、`headersJson`(密文)、`catalogProviderId`、`deletedAt` | `@@index([scope, enabled])`、`@@index([deletedAt])` |
| `ChannelModel` | `channelId`、`modelKey`、`providerModelKey`、`displayName`、`channelLabel`、`tags`(JSON)、`description`(≤500)、`sortOrder`、`icon`、`capability`、`protocol`、`billingMode`、四个售价、`priceConfigured`、`enabled`、`priceVersion`、`priceCurrency`、`capabilityConfigJson`、`capabilityVersion`、`catalogModelKey`、`deletedAt`、`activeKey` | `@@unique([channelId, activeKey])`、`@@index([channelId, enabled])`、`@@index([capability, protocol])` |
| `ChannelModelPriceTier` | 成本四价（`cost*`）、`selectorKey`、`selectorJson`、`resolution`、`videoSeconds`、`providerModelKey`、`billingMode`、四个售价、`priceConfigured`、`enabled`、`priceVersion`、`deletedAt`、`activeKey` | `@@unique([channelModelId, activeKey])` |
| `LogicalModel` | `code`、`name`、`icon`、`description`、`capability`、`enabled`、`sortOrder`、`revisionSequence`、`activeRevisionId`、`sourceChannelModelId`、`pricePolicy`(默认 `unified`)、`billingMode`、四个统一售价、`legacyModelIdsJson`、`archivedAt`、`activeKey` | `@@unique([activeKey])`（code，仅未归档）、`@@index([capability, enabled])` |
| `LogicalModelRevision` | `logicalModelId`、`version`、`capabilitySpecJson`、`defaultOptionsJson`、`createdBy` | `@@unique([logicalModelId, version])` |
| `LogicalModelRoute` | `logicalModelRevisionId`、`channelModelId`、`enabled`、`priority`、`weight` | `@@unique([logicalModelRevisionId, channelModelId])`、`@@index([enabled, priority])` |
| `RouteAttempt` | `taskId`、`routeRun`、`attemptNumber`、`logicalModelId`、`logicalModelRevisionId`、`routeId`、`channelModelId`、`channelId`、`status`、`dispatchState`、`providerRequestId`、`failureCode`、`failureMessage`、`startedAt`、`completedAt` | `@@unique([taskId, routeRun, attemptNumber])` |
| `UserGroup` | `code`、`name`、`description`、`badgeLabel`、`badgeStyle`、`sortOrder`、`ratioBasisPoints`(10000=1.0)、`pointsPerUsd`、`pointsPerCny`、`allChannels`、`modelOverridesJson`、`deletedAt`、`activeKey` | `@@unique([activeKey])`、`@@index([sortOrder])` |
| `UserGroupChannel` | `groupId`、`channelId` | `@@id([groupId, channelId])` |
| `BillingOrder` | 见 §6.2 | `@@index([userId, status])`、`@@index([taskId])`、`@@unique([userId, idempotencyKey])` |
| `CreditAccount` | `userId`(PK)、`availableMicrocredits`、`reservedMicrocredits`、`version` | 乐观并发 |
| `CreditLedgerEntry` | `userId`、`type`、`amountMicrocredits`、`availableDelta`、`reservedDelta`、`availableAfter`、`reservedAfter`、`billingOrderId`、`model`、`channelId`、`scene`、`note` | `@@index([userId, createdAt])` |
| `CreditReservationItem` | `billingOrderId`、`lotId`、`microcredits` | `@@id([billingOrderId, lotId])` |
| `ApiCallLog` | 见 §3.4 | `@@index([channelId, createdAt])`、`@@index([model, createdAt])`、`@@index([taskId])` |
| `PluginPlatformState` / `UserPluginState` | 系统插件可用性 / 单用户启用状态 | 分表，见 §7.4 |
| `RouteCatalogVersion` | `id`(单行)、`version` | 跨进程失效（无 Redis 时靠 DB 版本号） |

`LogicalModelPriceSKU` 在参考实现中**只有定义、无运行时引用**，本次不建表；统一售价由 `LogicalModel` 标量价 + 价格档投影表达。

### 3.2 SQLite / Prisma 适配规则

| 参考实现 | 本仓做法 |
| --- | --- |
| GORM 软删除 `deleted_at` | Prisma `deletedAt DateTime?` + 服务层 `where deletedAt: null`；删除一律软删 |
| 部分唯一索引 `WHERE deleted_at IS NULL` | 增加 `activeKey String?`：存活时等于业务键（`modelKey` / `code`），删除时置 `null`；唯一约束建在 `(scope, activeKey)` |
| JSON 序列化列 | 沿用本仓约定：`String` 存 JSON + 类型化 codec（zod 校验），不引入 Prisma `Json` |
| `int64` 微积分 | Prisma `BigInt`；API 以 number 输出，写入校验 ≤ `9_007_199_254_740_991`（约 90 亿积分） |
| GORM `Transaction` | `prisma.$transaction`；条件更新用 `updateMany` 判 `count === 1` 实现 CAS |
| Redis 阻塞/租约 | 本仓为单实例：内存表 + DB 版本号（未接 Redis）；多实例部署时冷却、并发槽与目录快照各自独立 |
| 无 enum | 状态一律 `String` + DTO 白名单（沿用现有约定） |
| 加密密钥 | 新增 `MODEL_SECRET_KEY`（32 字节 base64），AES-256-GCM，密文格式 `v1:<iv>:<tag>:<data>` |

### 3.3 现有表处理

| 现有 | 处理 |
| --- | --- |
| `ModelChannel`（modality/priority/health 版） | 删除，按 §3.1 重建；不做数据迁移（开发阶段无存量运营数据） |
| `ModelChannelConfig` | 删除；通道配置全部迁入 `ModelChannel` |
| `ModelCallLog` | 删除，由 `ApiCallLog` + `RouteAttempt` 取代 |
| `GenerationTask` | 原地扩展：`logicalModelId`、`logicalModelRevisionId`、`routeId`、`channelModelId`、`routeRun`、`billingOrderId`、`providerRequestId`、`pollStage`、`nextPollAt`、`leaseOwner`、`leaseUntil`、`attempts`、`stage`、`progress`、`authorizedChargeMicrocredits`；`provider` 恒为 `managed`；`creditCost` 改为账单金额只读投影 |
| `CreditLot` | 保留为「发放批次」，`amount` → `remainingMicrocredits BigInt`，增加 `expiresAt`；FEFO 扣减仍按批次 |
| `CreditTransaction` | 迁移为 `CreditLedgerEntry`（微积分、available/reserved 双列） |
| `User` | **不改表**：分组由「有效会员 → `MembershipPlan.userGroupCode`」解析（无有效会员落 `default` 分组），见 §14.2。控制器不得读用户列推断分组 |
| `MembershipPlan` | 增加 `userGroupCode String?`：会员等级映射分组，`fastChannel` 权益通过分组可见更优线路实现，不新增运行时分支 |

### 3.4 `ApiCallLog` 字段

`userId / taskId / billingOrderId / traceId / requestId / channelId / channelName / model / capability / operation / source / requestKind / billable / apiFormat / method / path / status / statusCode / durationMs / pollCount / providerStatus / inputTokens / outputTokens / cachedTokens / usageAvailable / mediaCount / videoSeconds / providerRequestId / estimatedCostMicros / costAvailable / currency / errorCode / error / concurrencyLimit / upstreamUrl / requestBody / responseBody / startedAt / createdAt`。

只允许 INSERT；请求/响应体按参考实现截断并脱敏，密钥不落库。

## 4. 接口

### 4.1 公开接口（`/api/v1`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/models` | 前台模型目录（按分组过滤线路与价格） |
| POST | `/models/available` | 带意图的可用性过滤 |
| POST | `/models/:id/quote` | 前台模型报价 |
| GET | `/model-catalog` | 系统渠道与渠道模型公开目录（`models: []` 恒为空，模型在 `channels[].models` 内）。**P5 交付**：P3 只上线 `/models*`，原始渠道模型目录与 C 端选型同批发布 |
| POST | `/model-catalog/available` | 带意图的渠道模型可用性（P5） |
| POST | `/model-catalog/quote` | 渠道模型报价（P5） |
| GET | `/channels/system` | 系统渠道连接信息（非管理员不下发） |
| POST | `/ai/models` | 用户自定义渠道拉取上游模型目录（需 `customChannels` 能力，30 次/分） |

### 4.2 后台接口（`/api/v1/admin`）

| 分组 | 接口 |
| --- | --- |
| 渠道 | `GET/POST /channels`、`PATCH/DELETE /channels/:id`、`POST /channels/:id/duplicate`、`POST /channels/export`、`POST /channels/import`、`GET/PUT /channels/order` |
| 渠道模型 | `GET /channels/:id/models`、`POST/PATCH/DELETE`、`PATCH .../enabled`、`PATCH .../sort`、`POST .../fetch`、`POST .../import`、`POST .../test`、`POST .../batch-delete`、`POST .../batch-reprice`、`GET/PUT /channels/:id/models/order` |
| 全量模型 | `GET /channel-models`、`GET /channel-models/health?channelId=` |
| 前台模型 | `GET/POST /logical-models`、`PATCH/DELETE /logical-models/:id`、`POST /logical-models/:id/simulate` |
| 用户分组 | `GET/POST /user-groups`、`PATCH/DELETE /user-groups/:id` |
| 插件 | `GET /plugins`、`POST /plugins/install`、`PATCH /plugins/:id`、`DELETE /plugins/:id`、`POST /plugins/:id/verify` |
| 账单与日志 | `GET /billing-orders`、`POST /billing-orders/:id/resolve`、`GET /api-logs`、`GET /analytics/finance` |
| 服务商目录 | `GET /provider-catalog`、`POST /provider-catalog/refresh`、`POST /provider-catalog/:id/verify`、`POST /provider-catalog/:id/install` |

所有写接口挂权限点（§9.3），高危动作写 `AdminAuditLog`。参考实现只有 `RequireAdmin` 粗粒度校验，本仓按现有权限体系细化——**这是移植时必须补强的一处**。

**服务商目录的口径差异（有意为之，不是缺口）**：参考实现的目录（`catalog.go`，`schemaVersion 1`）携带 `providers[].models[]` + CNY 价格档 + `keyGuide`，`install` 直接建渠道并带模型与定价，前端因此有「选服务商 → 填 Key → 模型与定价」三步向导。本仓的目录是**插件包上游清单**（`ProviderCatalogEntry`：名称 / 厂商 / `apiFormat` / `baseUrl` / `protocols` / `packageUrl`），`install` 复用 `PluginAdminService.install` 安装协议插件，落在后台「插件」页；建渠道与定价仍在「渠道工作台」手工完成。移植向导需要先引入一整套外部的厂商模型目录与人民币价格档，而本仓没有任何订阅源（`MODEL_PROVIDER_CATALOG_URL` 三档均为空），内置一份假目录只会让人误以为「已经支持 N 家厂商」——因此不做。

### 4.3 代理路由

| 路径 | 语义 |
| --- | --- |
| `ANY /api/v1/ai/system/:channelId/*path` | 系统渠道原样中转，使用服务端凭证，按模型计费 |
| `ANY /api/v1/{channelId}/*path` | 短路径中转；保留前缀（`tasks`、`plugins`、`admin` 等）不参与匹配 |
| `ANY /api/v1/ai/custom` | 用户自带 `X-Canvas-Upstream-URL` + 凭证中转；SSRF 校验、并发槽、限流 |

Nest 中以前置 `@All` 控制器 + 保留前缀清单实现，替代 Gin 的 `NoRoute`；必须在全局异常过滤与 SPA 回退之前注册。

**单请求顺序不可调整**：身份 → 分组渠道访问校验 → 限流 → body 上限 → 提取 model 并按协议/能力解析 → 协议授权 → SSRF 校验 → 剥离客户端 `key/api_key/access_token/token` → 附加渠道自定义头 → 并发槽 → **仅 POST 预留计费并置 running** → 上游请求 → 状态码/日志/流式透传 → 结算或 uncertain 或退款。

## 5. 运行时

### 5.1 任务准入

1. `POST /generate` 必须带 `logicalModelId`（`FeatureFrontendModels` 开关**删除**，恒为前台模型模式）。
2. 文本工具（提示词工具）同样走 `capability=text` 的前台模型。
3. 准入顺序：能力存在 → 参数白名单 → 素材归属 → 会员/并发 → 存储容量 → 模型解析 → 价格档 → 预留 → 建任务。
4. 模型解析失败一律在**扣费前**拒绝，映射到本仓错误码：
   - 模型不可用 / 已下线 → `40005`
   - 参数与模型能力不匹配 → `40001`
   - 未配置价格档 → `40001`（消息「指定的模型未配置当前规格的有效价格」）
5. 幂等键保留 `(ownerId, idempotencyKey)` 唯一约束；命中直接返回原任务与账单金额。

### 5.2 路由目录缓存

- 内存快照：`TTL 30s`、最大过期 `5min`、刷新失败冷却 `2s`；
- 失效：后台任何渠道/模型/前台模型/分组写入后 `invalidate()`，并将 `RouteCatalogVersion.version + 1`；
- 装载时剔除：渠道或模型停用、`pricePolicy=unified && billingMode=token` 但协议不支持 Token、`pricePolicy=channel` 但无有效价格档、能力配置非法；
- 快照内容：前台模型、revision、可路由线路、线路能力规格、默认参数。

### 5.3 意图与能力匹配

`ModelRequestIntent = { capability: text|image|video|audio, operation?, inputs: { image, video, audio }, options }`。

- 由能力插件 + 请求参数构造（§8.1）；
- `MatchCapability(productSpec, intent)` 校验操作、输入数量、参数枚举/范围；
- 图片尺寸归一：`size` / `quality` / `imageResolution` 统一换算为 `1k/1.5k/2k/4k` 档位参与匹配与计价；
- 只有模型能力配置**声明过**的参数才能进入意图；客户端残留字段不得把已关闭参数报成「不支持」。

### 5.4 选路

1. 过滤：线路启用、`weight > 0`、本轮未尝试、未被冷却、分组可见、能力匹配、`pricePolicy=channel` 时有命中价格档；
2. **只保留最高 priority 的一层**（priority 是硬分层，不参与加权）；
3. 同层按 `weight` 加权随机（crypto 随机 + 拒绝采样消除取模偏差）；
4. 结果写入任务快照：`logicalModelId / revisionId / routeId / channelModelId / routeRun=1`。

### 5.5 价格档（SKU）选择

- 选择器键：`operation`、`quality` / `resolution`、`size`、`vquality`、`videoSeconds`、`imageCount`、`videoGenerateAudio`、`fpsBand`；
- 规范化：小写、trim、`auto/any → *`、修正历史拼写 `resoluton`；
- 匹配：档位选择器中非空且非 `*` 的键必须相等，命中数计分取最高；`1.5k` 请求可落 `1k/2k` 相邻档；
- 档位 `providerModelKey` 非空时覆盖模型级上游键；
- 显式传入 `priceTierId` 时必须 `enabled && priceConfigured` 且图像参数匹配，否则回落到 intent 自动选；
- 无命中 → 拒绝（不回落标量价）。

### 5.6 尝试状态机

`RouteAttempt.status`：`selected | dispatching | succeeded | failed`
`RouteAttempt.dispatchState`：`not_sent | submission_unknown | accepted | rejected_no_job`

| 触发 | 迁移 |
| --- | --- |
| 选路成功 | 新建 `selected/not_sent` |
| 派发前 | CAS `not_sent → submission_unknown`（同时 `status=dispatching`）；CAS 失败即视为结果不明，禁止重发 |
| 上游已接受 | 记录 `providerRequestId` → `accepted` |
| 成功 | `succeeded/accepted` |
| 失败且无 providerRequestId | `safeRouteRejection` 为真 → `rejected_no_job`；否则 `submission_unknown` |
| 失败但有 providerRequestId | `failed/accepted`（不切换） |

**只有 `rejected_no_job` 才切换线路**；`submission_unknown` 一律停住等待人工/恢复，避免同一请求在两个上游各扣一次费。

### 5.7 故障切换

- `switchTaskToNextRoute`：从持久化 revision 重建候选池，以本轮已尝试 `routeId` 为排除集；重新选路、重建价格档；
- `pricePolicy=channel` 时必须生成**替换账单**并与任务切换同事务提交；余额不足或超 `chargeLimit` 则拒绝切换；
- 切换成功后清空 `providerRequestId`、新建下一 attempt，`routeRun` **不变**；
- `routeRun` 只在用户手动重试时 `+1`。

### 5.8 冷却

| 失败码 | 冷却键 | 时长 |
| --- | --- | --- |
| `upstream_401` / `upstream_403` | `channel:<id>` | 10 分钟 |
| `upstream_404` | `channel-model:<id>` | 10 分钟 |
| `upstream_429` | `channel:<id>` | 30 秒，上游 `Retry-After` 优先 |

- 冷却只写本进程内存（未接共享存储）；
- 读取同时检查 `channel:` / `channel-model:` / `route:` 三键；
- 只有 `safeRouteRejection`（渠道槽位失败或 401/403/404/429）才可能触发冷却；超时、5xx、连接中断不冷却也不切换。

### 5.9 worker 与租约

- 任务状态：`queued | running | succeeded | failed | cancelled`；
- 领取：条件更新 `status='queued' → running` + `leaseOwner/leaseUntil`，取回整行；
- 执行：恢复/创建 attempt → 派发 → 轮询；
- 轮询：`providerRequestId` 存在且 `nextPollAt` 到期才回查，回查期间释放执行位；
- 租约过期：`task-recover` 扫描 `leaseUntil < now()`，按 attempt 的 `dispatchState` 决定续跑 / 失败 / 待核对；
- 并发上限：`MODEL_ACTIVE_TASK_LIMIT`；渠道级并发槽 TTL = 请求超时 + 1 分钟，等待策略为 200ms 指数退避、上限 2s 加抖动。

### 5.10 产物回收

- 协议返回 URL → 下载（超时/重试）→ 存储落盘 → 登记 `Asset` → AIGC 标识；
- 上游已成功但下载/落盘失败：归类 `mediaRecoveryError`，**不切换线路**、不退款，任务延后重试；
- 只有上游明确未产出才进入失败与退款路径。

### 5.11 终态

| 情况 | 任务 | 账单 |
| --- | --- | --- |
| 成功 | `succeeded` | 结算（按实际用量） |
| 失败且上游确定未产出 | `failed` | 退款 |
| 失败但上游可能已产出 | `failed` | `uncertain`，进入人工核对 |
| 取消（渠道槽位前） | `cancelled` | 退款 |
| 取消（已派发） | `cancelled` | `uncertain` |
| 存量异常订单 | — | `auto-refund` 定时任务按规则自动退回；已有作品检查点的订单不自动退 |

无渠道不计费：未关联渠道且无法从 baseUrl 推出渠道时返回空账单（本仓要求必须有渠道，故正常情况下不会出现）。

## 6. 计费

### 6.1 单位与公式

- 1 积分 = 1,000,000 微积分（`CreditScale = 1_000_000`）；
- 单价、数量、倍率全程整数；
- 单笔：`ceil(unitPrice × quantity × bps / 10000)`；
- Token：`ceil(Σ(tokens × 单价) × bps / 1e10)`（bps × 微积分双尺度，单独实现，勿套用单笔公式）；
- Token 估算（上游无 usage）：输入 ≈ `len / 4`；输出上限 131072、默认 4096；
- 倍率连乘逐级向上取整，最小 1 基点，上限 `1 << 40`；
- 溢出前置校验，中间值超过 `Number.MAX_SAFE_INTEGER` 直接拒绝。

### 6.2 `BillingOrder` 字段

`userId / idempotencyKey / taskId / channelId / channelModelId / priceTierId / priceTierVersion / priceSelectorJson / model / capability / scene / billingMode / priceVersion / unitPriceMicrocredits / multiplierBasisPoints / userGroup / priceCurrency / currencyRateMicrocredits / quantity / amountMicrocredits / reservedAmountMicrocredits / chargeLimitSet / chargeLimitMicrocredits / actualAmountMicrocredits / refundedAmountMicrocredits / inputTokenPrice / outputTokenPrice / cachedTokenPrice / inputTokens / outputTokens / cachedTokens / videoFormulaTokens / usageSource / usageAvailable / status / cost*（成本快照，仅后台可见）/ promotionId / errorText / settledAt / createdAt / updatedAt`。

状态：`reserved | running | settled | refunded | uncertain`。

### 6.3 账户与预留

- `CreditAccount.availableMicrocredits / reservedMicrocredits / version` 为余额权威；
- `CreditLot.remainingMicrocredits` 为批次权威，FEFO 扣减；`available == Σ lots.remaining` 由每日对账任务校验；
- 预留：按 FEFO 从批次扣减 `remaining`，写 `CreditReservationItem`，账户 `available -= amount / reserved += amount`；
- 结算：消费预留，差额退回同一批次（保留原到期时间）；Token 超预授权时补扣并受 `chargeLimit` 约束；
- 退款：全额或差额退回原批次；已退款单支持幂等 restore；
- 过期：只处理未预留的 `remaining`；
- 流水类型：`grant / reserve / consume / refund / expire / adjust`，每条带 available/reserved 变动与变动后快照。

### 6.4 价格策略

| 策略 | 售价来源 | 叠加规则 |
| --- | --- | --- |
| `channel` | 渠道模型价格档单价 | 渠道档 × 分组倍率 × 货币换算；建单后把 `order.model` 改写为前台模型 code，供应线路留在内部字段 |
| `unified` | 前台模型标量价 | 只叠分组倍率，**不叠全局积分策略倍率** |

- `LogicalModel.pricePolicy` 默认 `unified`；`channel` 策略强制 `billingMode=fixed_request`（沿用参考实现约束）；
- 渠道模型 `priceCurrency`：`credits / USD / CNY`；成本价恒为微积分、不叠倍率、不参与售价；
- 分组倍率：`ratioBasisPoints`（10000 = 1.0）+ `pointsPerUsd / pointsPerCny`；模型级覆盖优先；覆盖值 0 表示沿用分组；
- 货币换算：`price × PointsPerUSD/CNY ÷ 1e6` 向上取整；`credits` 原样；
- 默认分组：开放全部渠道，1 CNY = 1 积分，1 USD = 7 积分；
- 会员 `userGroupCode` 决定分组；`fastChannel` 通过分组可见的高优先级线路实现。

### 6.5 计量

| 计费方式 | 计量 |
| --- | --- |
| `fixed_request` | 1 次 |
| `per_second` | 音频/视频实测时长（秒，向上取整）；音频缺省 1 秒；视频生成按请求时长预扣，处理类任务按输出时长结算 |
| `token` | 上游 usage 优先；缺失时按快照估算并标记 `usageSource`；视频 Token 只允许输出价 |

### 6.6 与现有商业域的关系

- 充值订单（`Order` / `Payment`）只负责「钱 → 积分批次」；生成扣费走 `BillingOrder`，两者不混用；
- 退款规则（`refund.windowDays` 等）继续作用于充值订单，不作用于生成账单；生成失败退款由账单状态机自动执行；
- 限时免费（`Campaign(type='limited_free')`）在**账单创建时**解析：命中即 `amount=0` 并记录 `promotionId`，成本快照仍记录，供毛利分析；
- 后台手动调分写 `adjust` 流水，不动账单。

## 7. 协议与插件

### 7.1 清单格式

沿用 `yingce.plugin/v2`：`metadata`、`runtime.backend`（`declarative` / `rpc` / `wasm` / `host:<engine>` / `web`）、`contributes.providers[]` / `operations[]`、`response` 映射、`upload` 前置、`files` 表单。

参考实现后台 `ManifestView` 硬编码 `yingce.plugin/v1`，与官方样例 `v2` 不一致——**移植时统一为 v2，不做双版本兼容**。

### 7.2 表达式 DSL

移植 `expression.go` 的声明式 JSON 表达式：模板求值、路径取值、默认值、类型转换、数组映射、条件分支。TS 实现为纯函数求值器，禁止 `eval` / `new Function`；用同一组清单做快照测试对齐。

### 7.3 内置协议

移植参考实现的 `builtin/*` 适配器与其 5 个 `rpc` 插件的宿主实现：`Metadata / BuildCreate / ParseCreate / BuildPoll / ParsePoll / BuildCancel`，可选 `Agent / Result / MediaUpload`。宿主无法用 TS 复刻的插件在后台标「当前环境不可用」并展示原因，不允许静默消失。

### 7.4 插件包与状态

- 包容器 `yingce.plugin/package-v1`：zip，最大 48MB，manifest ≤ 512KB，≤ 256 文件，单文件 ≤ 16MB；路径白名单、拒绝符号链接与越界路径；
- `backend/plugins/` 入库 110 个清单包（不含二进制，105 声明式 / 5 rpc）；
- 状态分表：`PluginPlatformState`（管理员可用性）、`UserPluginState`（单用户启用）；系统级协议/上传插件不用用户表；
- 上传限制：禁止 `host:` 后端；支付类插件仅允许 `rpc` / `wasm`；
- 协议注册表是渠道模型的唯一协议来源；未知协议在保存时拒绝，运行时绝不静默替换；
- 保存渠道模型时校验：协议已注册且启用、能力与协议元数据一致、特定厂商额外凭证（如即梦需 AK/SK）。

## 8. 与本仓能力体系对接

### 8.1 能力插件新增契约

`CapabilityPlugin` 增加（**必填**，装配期校验）：

```ts
model: {
  /** 模型能力类型 */
  capability: 'image' | 'video' | 'text' | 'audio';
  /** 默认操作（可被参数覆盖） */
  operation?: string;
  /** 能力参数 → 模型意图；同时决定输入素材数量与用途 */
  intent(params: Record<string, any>, inputs: { image: number; video: number }): ModelRequestIntent;
  /** 能力参数 → 请求参数覆盖（尺寸/质量等），默认直取同名 */
  options?(params: Record<string, any>): Record<string, unknown>;
};
```

装配期新增校验：`capability` 与 `modality` 一致、`intent` 必填、`operation` 非空、参数键必须能被模型能力合同表达。

### 8.2 16 项能力的映射

| 能力 | 模型能力 | 操作 | 输入 |
| --- | --- | --- | --- |
| `free_create` / `main_image` / `detail_image` / `sku_image` / `hot_remake` | image | `text_to_image`（带参考图 → `image_to_image`） | 0–1 |
| `creative_image` / `recolor` / `rotate` / `image_translate` | image | `image_to_image` | 1 |
| `enhance` / `expand` / `matting` / `remove_watermark` / `local_redraw` | image | `image_to_image` | 1（编辑底图） |
| `multi_fusion` | image | `image_to_image` | 2（`imageCount` 影响价格档） |
| `image_to_video` | video | `image_to_video` | 1 |
| 提示词工具 | text | `chat` | 0（可带参考图 → 多模态 content 块） |

参数映射：`ratio` + `size` → `size`（`WIDTHxHEIGHT` 或档位）；`quality` / `size` → `quality` / `imageResolution`；`variantCount` → `count`；`duration` → `videoSeconds`；`resolution` → `vquality`。

### 8.3 目录与选型

- C 端进入某能力页时，用该能力的默认意图请求 `POST /models/available`；
- 页面控件由「选中模型的 `capabilitySpec`」渲染（尺寸预设取可用线路并集），能力插件参数作为兜底与文案；
- 默认选中排序第一的可用模型；切换模型后重新报价；
- 无可用模型 → 页面禁用提交并显示原因（不回落、不隐藏）。

### 8.4 任务快照与重试

- 任务保存模型快照；重试沿用同一 `logicalModelId`，重新解析当前 revision；
- 前台模型已归档时，历史任务重试只允许使用原 revision/route/channelModel 快照；原线路失效则明确拒绝，不静默换模型。

## 9. 后台与前端

### 9.1 后台页面

| 页面 | 内容 |
| --- | --- |
| `/admin/channels` | 渠道工作台：列表、编辑抽屉（连接/凭证/请求头/代理/并发）、模型列表与价格档、成本与售价并列、批量调价/删除、排序、导出导入、上游拉取/导入/测试、健康 |
| `/admin/logical-models` | 前台模型：能力合同编辑器、线路选择（priority/weight）、默认参数、价格策略、路由模拟；`channel` 策略下价格只读并提示去渠道模型定价 |
| `/admin/user-groups` | 分组：可见渠道、倍率、货币兑换、模型覆盖、用户数 |
| `/admin/plugins` | 插件：内置/上传、启停、能力统计、校验结果 |
| `/admin/model-calls` | 调用记录（`ApiCallLog` 维度） |
| `/admin/billing-orders` | 账单：状态、用量、成本、人工核对 |

批量改价规则：`售价 = cost × (1 + markup)`，四舍五入（half-up），单次 ≤ 100 个价格档。全部使用 `admin-ui` 组件与 `DataTable`，不引 antd，不做移动端适配。

### 9.2 C 端

- 工作台与工具页接入模型选择器（`frontend/src/components/model-picker`），展示名称/图标/标签/价格档；
- 参数控件按模型能力合同渲染；
- 提交请求增加 `logicalModelId`；报价展示实时金额；
- 任务详情展示实际模型名称与计费金额（不展示渠道与上游标识）。

### 9.3 权限点（新增）

`channel.read / channel.write / channel.model_read / channel.model_write / logical_model.read / logical_model.write / user_group.read / user_group.write / plugin.read / plugin.write / billing_order.read / billing_order.resolve / model.analytics_read`

高危（写操作留审计）：`channel.write`、`channel.model_write`、`logical_model.write`、`user_group.write`、`plugin.write`、`billing_order.resolve`。其中调价、账单人工核对等确有业务依据要求的动作必须填写原因；删除渠道与渠道模型只保留业务影响确认，不要求填写原因。

（实施口径：凭证、价格档与渠道模型连通性测试都挂在 `channel.write` / `channel.model_write` 上；没有独立的 `secret_write` / `price_write` / `model_test` 权限点——它们不在任何路由上校验，留着只会制造「已收窄权限」的错觉。）

## 10. 迁移与交付分期

每期独立可运行、可验收；上一期验收未过不得进入下一期。开发阶段不保留旧实现（除 P0 前的数据备份外）。

| 期 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 依赖与地基：microcredits、`CreditAccount/CreditLedgerEntry`、`outbound`（SSRF/代理/自定义头）、`secret-cipher`、插件包入库、协议 registry 骨架 | 单测：金额算术、SSRF、密文往返、110 个清单全部可解析 |
| P1 | 渠道与模型数据层：全部新表、仓库、渠道 CRUD/复制/导入导出/排序、模型 CRUD/价格档/批量 | `prisma:push` 通过；后台渠道页完成一次完整配置；`verify` 脚本校验模型/价格档一致性 |
| P2 | 协议与执行：manifest 适配器、表达式 DSL、内置协议、测试调用、上游拉取 | 用真实密钥对至少 1 家 image + 1 家 video 完成连通性测试；`api-logs` 有记录 |
| P3 ✅ 已交付 | 前台模型与路由：revision/route、目录快照、意图匹配、选路、报价。落地 `src/model/{intent,routing,catalog,user-groups}`，公开 `/models`、`/models/available`、`/models/:id/quote` 与后台 `POST /admin/logical-models/:id/simulate`；`/model-catalog*`（原始渠道模型目录）按 P5 与 C 端选型一起交付，避免半成品接口 | `npm run verify:route-catalog`：priority 分层与下沉、同层加权分布、SKU 选择（精确/通配/1.5K 相邻/停用档）、冷却三键、`simulate` 与 `resolve` 选中同一线路与价格档、目录投影的渠道可见性与换算顺序；后半段起 Nest 打真实 HTTP 校验四个端点的接线与守卫 |
| P4 ✅ 已交付 | 任务与计费：准入改造、worker/租约/轮询、attempt 状态机、预留/结算/退款。落地 `src/model/billing/{billing,credit-wallet}.service`（含 `CreditLedgerEntry.lotId`）与 `src/model/tasks/*`（准入 / 执行 / 尝试 / 生命周期 / 轮询 / 并发槽） | `npm run verify:billing`：预留幂等、固定价结算、Token 差额退回 / 超预授权补扣 / 授权上限截断、按秒重算、失败退款幂等、已结算拒绝自动退款、`uncertain` 转人工、余额不足 `40002`，每步校验 `available == Σ remaining`。`npm run verify:task-runtime`：本机 HTTP mock 上游跑端到端——同步成功（产物落盘 + `settled` + 按目录价扣费）、401 切线（旧账单退回、新账单按新线路价结算、`task.creditCost` 同步）、轮询超时（`42206`、`uncertain`、**不切线**、上游零调用）、唯一线路 429（`42204`、全额退款、余额回正），并校验「可用余额 == Σ 批次剩余」 |
| P5 ✅ 已交付 | 后台页面与 C 端选型：`AdminChannelsPage`（渠道主从布局 + 左列承载新建 / 导入 / 导出全部 / 排序，详情头部承载编辑 / 复制 / 导出 / 启停 / 删除，内联模型管理 + 全部模型视图 + 结构化请求头编辑）、`AdminLogicalModelsPage`（revision / 线路 / 路由模拟）、`AdminUserGroupsPage`、`AdminPluginsPage`、`AdminBillingOrdersPage`、`AdminModelCallsPage`（改走 `/admin/api-logs`）；C 端 `ModelPicker` + `lib/modelSelection`（按能力记忆）+ `resolveModelId` 记忆优先，历史卡显示模型名与 `creditCost` 快照；`/model-catalog*` 公开 | `frontend/tests/admin-model-suite.spec.ts`：配置 → 选型 → 报价 → 生成 → 账单核对。生成段需要一条可用 image 线路（`cd test && node server.js` 仿真网关，或真实密钥），无线路时该段如实跳过并断言 C 端给出「当前没有可用线路」 |
| P6 ✅ 已交付 | 代理与运营：系统中转、短路径、自定义中转、分组、插件管理、财务分析、自动退款。落地 `src/model/proxy/**`（路径授权 / SSRF 出站 / 计费 / 调用记录 / 并发槽 / 清扫）与 `src/model/{billing/finance-analytics,plugins,user-groups}` | `npm run verify:proxy-runtime`：A 段纯逻辑——`validateCustomRelayUrl` 与 `resolveOutboundHost` 的回环 / 私网 / 链路本地 / 云 metadata / 保留网段 / IPv6 / `localhost` / HTTP 仅可信主机、路径白名单与密钥查询参数、并发槽、插件包解析拒绝分支；B 段自起 Nest + 本机 mock 上游——`GET /models` 不计费并剥离客户端密钥、`POST` 的 `reserved → settled` 与调用记录、SSE 透传、500 退款、524 `uncertain` 不退款、渠道与用户并发槽 `429`、自定义中转 401/403 与 JSON/SSE 双路径脱敏、系统中转限流 `42901`、分组可见性 `40301` 且不建账单、清扫两条迁移且不碰任务账单、钱包恒等式、财务口径与 `BillingOrder` 聚合逐项一致、插件安装/重复 `40909`/被引用拒卸 `40909`/内置 `40001`/卸载成功。未覆盖项见 `docs/testing.md` §5.6 |

### 10.1 删除清单（P6 完成后一次性执行）

- `backend/src/providers/**`（全部）
- 后台 `model-config` 中旧通道逻辑、`ModelCallLog` 写入方
- `prisma` 中 `ModelChannelConfig`、旧 `ModelChannel`、`ModelCallLog`
- `GATEWAY_*` 环境变量与 `providers/channel-config.defs.ts`
- `frontend/src/pages/admin/modelConfig/**`
- `frontend/src/lib/capabilities` 中模型/通道相关字段（保留能力定义）
- `docs/model-architecture.md` 重写为「协议插件 + 路由 + 计费」现状

### 10.2 回滚

- 每期以迁移分支交付；P0–P3 不触碰线上流量；
- P4 起任务表新增列沿用「可空 + 回填」；旧实现删除后回滚 = 回退代码 + 回退迁移，不保留双写。

## 11. 测试与验收

| 层 | 覆盖 |
| --- | --- |
| 单测 | 微积分算术与溢出、价格档选择、意图匹配、加权分布、冷却矩阵、账单状态机、表达式 DSL、清单校验、SSRF、密文 |
| 集成 | 目录 → 报价 → 预留 → 派发 → 结算全链路（仿真上游）；切线；不确定订单；自动退款 |
| 契约 | 110 个插件清单解析快照；公开目录响应结构；后台接口字段 |
| e2e | 后台配置渠道模型 → 建前台模型 → C 端选型 → 报价 → 生成 → 账单与调用记录 |
| 迁移 | `db:reset:test` 后种子可建出默认可运行配置；`probe-environments` 通过 |

## 12. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 移植面大，回归定位困难 | 按 P0–P6 切分；每期保留参考实现同构单测；关键路径先跑红再修 |
| Go → TS 语义差异（int64、时间、JSON 数字） | 微积分统一 BigInt；金额出 API 前做安全整数校验；金额单测与参考实现样例对齐 |
| SQLite 并发与租约 | WAL + `busy_timeout`；领取用条件更新；单实例部署（跨实例协调未实现） |
| 插件包数量大、启动慢 | 启动只解析 manifest；运行时按需展开；缓存解析结果 |
| 计费改造影响现有充值/退款 | `BillingOrder` 与 `Order` 分离；充值链路不动；退款规则仍作用于充值订单 |
| 能力与模型契约漂移 | 装配期校验 + 目录按意图过滤；C 端控件只由模型能力合同渲染 |
| 权限缺失（参考实现只有管理员判定） | 本仓补权限点与审计；写操作全部落 `AdminAuditLog` |

## 13. 附录：源文件 → 目标文件对照

| 参考实现（Go） | 本仓（TS） |
| --- | --- |
| `internal/model/models_channel.go` | `prisma/schema.prisma` + `src/model/**/types.ts` |
| `internal/model/models_logical_model.go` | 同上 |
| `internal/model/models_finance.go` | 同上（`BillingOrder`） |
| `internal/model/models_user_group.go` | 同上 |
| `internal/model/credit_cost.go` | `src/model/infra/microcredits.ts` |
| `internal/app/model_router.go` | `src/model/routing/router.service.ts` |
| `internal/app/model_router_attempts.go` | `src/model/routing/attempt.service.ts` |
| `internal/app/model_router_capability.go` | `src/model/intent/capability-match.ts` |
| `internal/app/finance.go` / `credit_policy.go` | `src/model/billing/billing-order.service.ts` + `src/model/infra/microcredits.ts` |
| `internal/kernel/token_billing.go` | `src/model/billing/token-billing.ts` |
| `internal/app/logical_models.go` | `src/model/logical-models/logical-model.service.ts` |
| `internal/app/logical_models_catalog.go` | `src/model/catalog/catalog.service.ts` |
| `internal/app/logical_model_quote.go` | `src/model/catalog/quote.service.ts` |
| `internal/app/channel_models.go` | `src/model/channels/channel-model.service.ts` |
| `internal/app/channel_model_pricing.go` | `src/model/channels/channel-model-pricing.service.ts` |
| `internal/app/channel_models_catalog.go` | `src/model/channels/channel-model-catalog.service.ts` |
| `internal/app/admin_channels.go` | `src/model/channels/channel.service.ts` |
| `internal/app/channel_transfer.go` | `src/model/channels/channel-transfer.service.ts` |
| `internal/app/channel_order.go` | `src/model/channels/channel-order.service.ts` |
| `internal/app/admin_channel_model_health.go` | `src/model/channels/channel-health.service.ts` |
| `internal/app/user_groups.go` | `src/model/user-groups/user-group.service.ts` |
| `internal/repository/finance_billing.go` | `src/model/billing/billing-order.service.ts` |
| `internal/app/task_billing.go` | `src/model/billing/billing-coordinator.service.ts` |
| `internal/app/task_creation.go` | `src/model/tasks/task-admission.service.ts` + `src/generate/generate.service.ts` |
| `internal/app/task_worker.go` / `task_route_executor.go` / `task_terminal.go` | `src/model/tasks/task-*.service.ts` |
| `internal/protocol/manifest.go` / `expression.go` / `builtin.go` / `package.go` | `src/model/protocol/*` |
| `internal/app/protocol_plugins.go` / `plugin_management.go` | `src/model/plugins/plugin.service.ts` |
| `internal/handler/model_catalog.go` / `logical_models.go` | `src/model/http/catalog.controller.ts` |
| `internal/handler/auth.go` 中转段 | `src/model/proxy/system-proxy.controller.ts` |
| `internal/handler/custom_proxy.go` | `src/model/proxy/custom-relay.controller.ts` |
| `internal/handler/security.go` | `src/model/proxy/upstream-authorization.service.ts` |
| `internal/outbound/outbound.go` | `src/model/infra/outbound.ts` |
| `internal/platform/coordination.go` | `src/model/proxy/concurrency.service.ts` |
| `plugin-packages/*` | `backend/plugins/*` |
| `web/src/pages/admin/channels/**` | `frontend/src/pages/admin/channels/**` |
| `web/src/pages/admin/logical-models/**` | `frontend/src/pages/admin/logical-models/**` |
| `web/src/pages/admin/user-groups/**` | `frontend/src/pages/admin/user-groups/**` |
| `web/src/components/model-picker.tsx` | `frontend/src/components/model-picker/**` |
| `web/src/components/model-capability-editor.tsx` | `frontend/src/components/model-capability-editor/**` |

## 14. 实施前必须确认

1. **积分为整数还是微积分对外展示**：本方案对外仍展示「积分」，内部微积分；C 端金额四舍五入展示，扣费按微积分精确结算。若产品要求展示到小数点后 2 位，需在站内设置增加展示精度。
2. **会员与分组的关系**：本方案用 `MembershipPlan.userGroupCode` 映射；若运营希望「一个会员可对应多个分组」，改为多对多。
3. **插件包是否全部入库**：110 个清单包体积可控；若只保留当前在用的厂商，需在 P0 明确清单，避免后续「插件缺失」被误判为功能裁剪。
4. **是否保留前台模型灰度开关**：本方案删除 `FeatureFrontendModels`（恒开）。若需灰度，改为站内设置 `model.frontendModels` 运行时开关，默认开。
