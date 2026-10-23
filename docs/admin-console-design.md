# 后台管理端 · 功能设计

货觉AI · MVP ｜ 2026-10-19 ｜ 状态：**设计已落地**（B0–B8，2026-10-21；正文「15 项能力 / 无后台」等表述为当时快照，当前以代码与 [`CLAUDE.md`](../CLAUDE.md) 为准）

> **本文是分域附件，层级低于后台 PRD** `docs/admin-prd.md`（后台管理系统需求）；实现细节见 `docs/admin-detailed-design.md`。整站产品需求见 `docs/prd.md`。
> 本文 §0-5 的「两级 role」已被总纲 §2 改判为 **RBAC 三角色**（admin/operator/finance）；批次编号 A1-C1 已被总纲 §12 的 M1-M16 取代。实现时以 PRD 与总纲为准。

---

## 0. 结论先行

| # | 裁定项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 部署形态 | **同仓同进程**：前端新增 `/admin/*` 路由子树 + 独立 `AdminLayout`；后端新增 `admin/` 模块挂 `/api/v1/admin/*` | MVP 单仓单进程，另起服务只增运维成本 |
| 2 | 外壳是否复用用户端 | **不复用**。管理端用 antd `Layout + Menu`，砍掉营销顶导 / 能力侧栏 / 促销条 | `AppLayout.tsx:60-140` 顶导与 `SideRail` 全部是 C 端语义，混入后台是噪音 |
| 3 | 权限模型 | `User.role: String`（`user`/`admin`）+ 新增 `AdminGuard`（**每次查库**判角色，token 内的 role 只作 UI 提示） | 现 `JwtAuthGuard` 只解出 `{id, email}`（`common/jwt-auth.guard.ts:29`），提权后 token 7 天 TTL 内残留风险（`common/jwt.service.ts`） |
| 4 | 管理员账号来源 | **不复用 `admin@demo.com`**。新增 `scripts/seed-admin.ts` 生成随机强密码；演示账号保持 `user` | `frontend/src/lib/constants.ts:15-18` 把 `admin@demo.com/demo1234` 硬编码进产物，给它 admin 等于把后台钥匙挂在门口 |
| 5 | 计费 / 积分后台 | **已改判：做**。用户 2026-10-19 追加「支付，积分，订单，商品」，本文档 §5/§6/§7/§9 相应扩为 4 个模块，详见 `docs/commerce-design.md` | 用户指令；原「不做」的依据是「无业务表」，现业务表由 commerce 设计新建 |
| 6 | 内容审核工单 | **降级为「作品巡检」**，只读 + 单条下架，不做审核队列/工单流转 | 素材库是 owner 私有（`assets.service.ts` 全部按 `ownerId` 过滤），无公开 UGC，审核流是伪需求 |

一句话：**这是「平台运营后台」**。做 8 个模块（+ commerce 追加的 4 个），全部落在 `User`/`Project`/`Asset`/`GenerationTask` 与 commerce 新建的 6 表上。

---

## 1. 现状事实基线

代码为唯一权威源，以下均已实读。

| 事实 | 出处 | 对设计的约束 |
|---|---|---|
| 数据模型仅 4 表：`User` / `Project` / `Asset` / `GenerationTask` | `backend/prisma/schema.prisma` | 所有后台统计必须从这 4 表聚合，不引入"尚不存在"的概念 |
| `User` 无 `role`、无 `status`、无 `lastLoginAt` | 同上 `:11-18` | 必须先扩列 |
| SQLite provider 不支持 Prisma enum，`kind`/`status`/`capability` 一律 String + DTO 白名单 | schema 头注释 `:3-5` | 新增 `role`/`action` 等同样 String 存储 + 白名单 |
| 能力清单单一事实源在 `capability.registry.ts`，经 `GET /api/v1/capabilities` 公开下发 | `capabilities.controller.ts:13-25` | 后台不能改代码里的 `mode`，需 DB override 表叠加 |
| 现状 15 项能力 = real 7 / mock 8 / planned 0 | registry + `CLAUDE.md:113` | 后台「能力管理」第一屏就是这份 mode 分布 |
| `stats/overview` 强制按 `ownerId` 过滤，是 C 端个人数据中心 | `stats/stats.service.ts:12` | 平台级看板需要一套独立的 admin 聚合，**不能复用** |
| 生成任务带 `provider`（`gateway`/`local`）、`errorCode`、`status` | `GenerationTask` 模型 | 通道健康度与失败归因**已有数据源**，不需要新埋点 |
| 网关由 `GATEWAY_*` 环境变量驱动，路由可按能力覆盖 | `CLAUDE.md:130-143` | 后台要改运行时路由，必须有 DB 设置表 + env 兜底优先级 |
| 演示凭据 `admin@demo.com/demo1234` 硬编码在前端产物 | `lib/constants.ts:15-18` | 不可作为管理员，见 §0-4 |
| 前端 25 条路由全部包在 `Shell` 内（`AppLayout`） | `App.tsx:144-337` | `/admin/*` 必须在 `Shell` 之外分流，否则会被 catch-all 吞掉 |
| `RequireAuth` 只判 token 存在，不判角色 | `App.tsx:59-64` | 需新增 `RequireAdmin` |
| 无任何后台/运营相关页面 | `frontend/src/pages/` 24 个页面全是 C 端 | 全新模块 |

---

## 2. 定位与边界

**是什么**：平台运营方（你本人 + 后续客服/运营）用的内部控制台。

**不是什么**：
- 不是 C 端用户的"账号设置页"（那是 `/works` `/library` `/stats` 的职责）
- 不是内容审核平台（无公开 UGC，见 §0-6）
- 不是计费/财务后台（无计费系统，见 §0-5）
- 不是给终端用户的多角色权限系统（只有 user/admin 两级，不做 RBAC 自定义）

---

## 3. 信息架构

```
/admin                     平台概览（Dashboard）
/admin/users               用户列表
/admin/users/:id           用户详情（抽屉或子页）
/admin/projects            全平台项目
/admin/assets              全平台素材
/admin/tasks               任务监控
/admin/tasks/:id           任务详情
/admin/capabilities        能力与通道
/admin/settings            系统设置
/admin/audit-logs          操作审计
```

侧栏分组（7 项，分 4 组）：

| 组 | 菜单 | 路由 | 优先级 |
|---|---|---|---|
| 总览 | 平台概览 | `/admin` | P0 |
| 运营 | 用户管理 | `/admin/users` | P0 |
| 运营 | 项目 / 素材 | `/admin/projects`、`/admin/assets` | P0 |
| 运营 | 任务监控 | `/admin/tasks` | P0 |
| 交易 | 商品管理 | `/admin/products` | P0（commerce） |
| 交易 | 订单管理 | `/admin/orders` | P0（commerce） |
| 交易 | 积分账本 | `/admin/credits` | P0（commerce） |
| 交易 | 支付流水 | `/admin/payments` | P1（commerce） |
| 配置 | 能力与通道 | `/admin/capabilities` | P1 |
| 配置 | 系统设置 | `/admin/settings` | P1 |
| 系统 | 操作审计 | `/admin/audit-logs` | P1 |

入口：登录成功后 `AuthContext` 若拿到 `role === 'admin'`，在 C 端顶导 `app-user` 下拉里加一项「进入后台」；同时 `/` 直达 `/admin` 时若非管理员 → 跳 `/workbench`。

---

## 4. 功能模块设计

### 4.1 平台概览 `/admin` — P0

平台级聚合，全部来自 4 张表。

| 指标卡 | 计算口径 |
|---|---|
| 用户总数 / 7 日新增 | `count(user)` / `count(user where createdAt >= now-7d)` |
| 项目总数 | `count(project)` |
| 素材总量 / 原始 / 生成 | `groupBy(kind)` |
| 任务总量 / 成功 / 失败 / 进行中 | `groupBy(status)`，成功率 = succeeded/(succeeded+failed) |
| 网关命中率 | `provider='gateway'` 占比（近 7 天） |

图表区：
- 近 14 天任务趋势折线（按 `createdAt` 日聚合）
- 能力使用分布横向条（`groupBy(capability)`，join registry 拿中文名与 mode）
- 通道来源分布（`groupBy(provider)`）
- 失败 Top 能力（`groupBy(capability) where status='failed'`，带最近 errorCode）

> 全部真实统计。**不出现**"今日营收 / 付费转化 / 积分消耗"这类无表支撑的卡片（对齐现有 `StatsPage` 的诚实口径）。commerce 落地后，营收/积分类卡片迁至 `/admin/finance/summary`（见 `commerce-design.md` §8.2），本概览只留运营指标。

### 4.2 用户管理 `/admin/users` — P0

| 能力 | 说明 | 优先级 |
|---|---|---|
| 列表 | 邮箱 / 昵称 / 角色 / 状态 / 注册时间 / 最近登录 / 项目数 / 任务数 / 素材数；支持邮箱模糊搜索、按注册时间/任务数排序、服务端分页 | P0 |
| 启用 / 禁用 | 置 `User.status = disabled`；**禁用后 JWT 立即失效**（AdminGuard 与 JwtAuthGuard 均校验） | P0 |
| 角色变更 | `user ↔ admin`，最后一个 admin 不允许降级（服务层断言 + 409） | P0 |
| 重置密码 | 管理员设临时密码（一次性），前端展示一次后不再可见 | P1 |
| 删除用户 | 软删除优先（status=`deleted` + 保留数据）；物理删除连带项目/素材/任务/磁盘文件，**二次确认 + 明确列出将删除的量** | P1 |
| 用户详情 | 基本信息 + 3 个统计 + 最近 20 条任务 + 最近 20 张素材缩略图 | P0 |

不可做：改密码（需本人或重置流程）、查看明文密码（不存在）。

### 4.3 项目 / 素材 `/admin/projects`、`/admin/assets` — P0

| 模块 | 列表能力 | 详情/操作 |
|---|---|---|
| 项目 | 名称 / 所属用户 / 素材数 / 任务数 / 创建时间 / 搜索与排序 | 删除项目（连带素材与任务，二次确认） |
| 素材 | 缩略图 / kind / capability（join registry 名称）/ 尺寸 / 格式 / 大小 / 所属项目与用户 / 上传时间 | **下架**（置 `status='hidden'`，C 端列表过滤）/ 删除（连带磁盘文件）/ 打开原图 |

素材列表是后台最重的表，需要：分页、缩略图网格 + 表格视图切换、按 kind/capability/用户/时间筛选。

> 「下架」需要给 `Asset` 加 `status` 列（`visible`/`hidden`），并在 `assets.service.ts` 的用户端列表过滤 `status='visible'`——这是**唯一一处会改 C 端行为**的变更，需单列说明。

### 4.4 任务监控 `/admin/tasks` — P0

| 能力 | 说明 |
|---|---|
| 列表 | 任务 ID / 能力 / 状态 / 通道(provider) / 用户 / 项目 / 创建与更新时间 / 耗时 / errorCode；按 status、capability、provider、时间范围筛选 |
| 详情抽屉 | 输入素材缩略图、参数 JSON（`JSON.stringify(params, null, 2)`）、产出图、完整错误码、轮询耗时 |
| 统计条 | 当前 pending / running 数量（>50 视为拥堵告警，标红） |
| 重试 | 对 `failed` 任务，用原参数与原输入重建任务（新建记录，不复用旧 ID），返回新 taskId |
| 终止 | 对 `running` 任务置 `status='failed'` + `errorCode='cancelled_by_admin'` |

> 重试不做"原地复活"，避免产物 1:1 约束（`GenerationTask.outputAssetId @unique`）被绕过。

### 4.5 能力与通道 `/admin/capabilities` — P1

| 能力 | 说明 | 优先级 |
|---|---|---|
| 能力清单总览 | 15 项表格：名称 / 分组 / mode（real/mock/planned）/ 参数个数 / 工作台是否展示 / 近 7 天调用量 / 成功率。数据源仍是 registry | P0（只读） |
| mode 覆盖 | 建议本期走 `SystemSetting` 键值（不另建 `CapabilityOverride` 表，见 PRD §3.4）；C 端 `GET /capabilities` 在service 层合并后下发 | P1 |
| 上/下线能力 | `enabled=false` 时 C 端侧栏与工作台不展示 | P1 |
| 单能力通道路由 | 覆盖 `GATEWAY_ROUTE_<能力ID>`：`auto`/`local`/`remote`，存 `SystemSetting` | P1 |
| 全局通道开关 | 等价 `GATEWAY_ENABLED`，存 DB（优先级：DB > env） | P1 |
| 通道测试 | 「测试连接」按钮：后端用当前凭据对网关发一次最小请求，返回真实耗时与结果摘要；**token 脱敏显示（仅前 4 后 4）** | P1 |
| 凭据状态 | 只显示 `GATEWAY_BASE_URL` 是否设置、token 是否存在、脱敏值、**不提供明文查看/编辑**（编辑走部署环境变量，界面明示） | P0（只读） |

> 环境变量是部署期事实源。后台改 DB 属运行时覆盖，必须在界面明确标注「运行时覆盖，重启后仍生效但 env 优先级更高」，避免误以为改 env。

### 4.6 系统设置 `/admin/settings` — P1

| 分组 | 项 | 存储 |
|---|---|---|
| 站点 | 站点名称、维护模式开关（开启后 C 端只读，生成接口 503） | `SystemSetting` |
| 上传 | 单文件大小上限（默认 20MB，与 `assets.controller.ts:34` 对齐）、允许的文件类型 | `SystemSetting` |
| 生成 | 默认轮询上限、超时（对应 `GATEWAY_TIMEOUT_MS`/`MAX_POLLS`）、并发任务上限 | `SystemSetting` |
| 安全 | JWT TTL 提示（只读，标注"生产应改短 TTL + refresh"）、管理员白名单展示 | 只读 |
| 存储 | `uploads/` 目录占用与文件数、原始/生成分目录统计 | 运行时统计 |

维护模式是唯一一个会改变 C 端全局行为的开关，需在后端 `JwtAuthGuard` 之后加一道全局拦截（或在 generate controller 前判定）。

### 4.7 操作审计 `/admin/audit-logs` — P1

所有写操作（禁用用户、删项目、改 mode、开关维护模式、重试任务等）落 `AdminAuditLog`：`actorId / action / targetType / targetId / detail(JSON) / ip / createdAt`。

页面：按操作人 / action / 时间筛选，分页。**只读、不可删**（审计不可自证清白的反面：审计记录本身要防篡改，留作 P2 的 hash 链或独立库）。

### 4.8 商品 / 订单 / 积分 / 支付（commerce 追加）— 见 `docs/commerce-design.md`

用户 2026-10-19 追加「支付，积分，订单，商品」后，后台新增 4 个模块。完整设计（字段、状态机、API、批次）见 `docs/commerce-design.md`，此处只列归属：

| 模块 | 路由 | 归属文档 |
|---|---|---|
| 商品管理（SKU 增删改、上下架、能力消耗价表） | `/admin/products` | commerce §8.2 |
| 订单管理（列表、详情、手工核销、退款） | `/admin/orders` | commerce §8.2 |
| 积分账本（用户余额总览、批次明细、人工增减） | `/admin/credits` | commerce §8.2 |
| 支付流水与财务概览 | `/admin/payments`、`/admin/finance/summary` | commerce §8.2 |

后端 guard 与 §5 权限模型共用；`/admin/credits` 的人工增减、`/admin/orders` 的核销与退款**必须写 `AdminAuditLog`**。

---

## 5. 权限模型

```
JwtAuthGuard（现有）→ AdminGuard（新增）→ Controller
```

`AdminGuard` 职责：
1. 校验 Bearer token（复用 `JwtAuthGuard` 逻辑，不重复实现）
2. `prisma.user.findUnique({ where: { id: sub } })` 取 `role` 与 `status`
3. `role !== 'admin'` → `AppError(40301, '需要管理员权限', 403)`
4. `status === 'disabled'` → `AppError(40302, '账号已被禁用', 403)`

**为什么每次查库**：token TTL 7 天，若 role 只信 token，管理员降权/被禁用后旧 token 仍可用 7 天。SQLite 本地单文件，admin 接口低频，查库成本可忽略。

前端：`RequireAdmin` 组件（`App.tsx` 同款模式）——无 token 跳 `/login`，有 token 但非 admin 跳 `/workbench` 并 toast「需要管理员权限」。

---

## 6. 数据模型变更

### 6.1 User 扩列（向后兼容）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `role` | String | `"user"` | 白名单 `user` \| `admin` |
| `status` | String | `"active"` | 白名单 `active` \| `disabled` \| `deleted` |
| `lastLoginAt` | DateTime? | — | 登录时更新 |

### 6.2 新增表

| 模型 | 字段 | 用途 |
|---|---|---|
| `AdminAuditLog` | `id / actorId / action / targetType / targetId / detail / ip / createdAt` + `@@index([actorId])` `@@index([createdAt])` | 写操作审计 |
| ~~`CapabilityOverride`~~ | ~~`capabilityId @id / mode / enabled`~~ | ⚠️ **建议暂缓（PRD §3.4 / D7）**：本期 mode 由 registry 静态声明即可，DB override 只在需要不发版切换时才值得。表中已预留 `SystemSetting` 可承载相同语义 |
| `SystemSetting` | `key @id / value / updatedBy / updatedAt` | 站点/上传/生成/通道运行时配置 |

> 不建 `ModerationTicket` / `Role` / `Permission`——无业务支撑，建了就是死表。
> `Order` / `Point` 类表原也在此列，但 commerce 设计已新增 `Product` / `Order` / `OrderItem` / `CreditLot` / `CreditLedger` 共 **5** 表（D7 已删 `ProductCapabilityPrice`），见 `docs/commerce-design.md` §3。

### 6.3 配置优先级链（唯一事实源不被破坏）

```
代码 registry / 环境变量（部署期，权威）
        ↓ 被覆盖
SystemSetting（运行期，后台可改；原 CapabilityOverride 表已按 D7 暂缓）
```

`GET /api/v1/capabilities` 需在 `capabilities.service` 层合并 override 后下发，**registry 文件本身保持纯静态、仍是默认值事实源**。

---

## 7. API 清单（新增，全部 `/api/v1/admin/*` + JwtAuthGuard + AdminGuard）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/overview` | 平台总览聚合（§4.1） |
| GET | `/admin/overview/trend?days=14` | 任务趋势序列 |
| GET | `/admin/users?keyword&role&status&page&pageSize&sort` | 用户分页 |
| GET | `/admin/users/:id` | 用户详情（含统计与最近记录） |
| PATCH | `/admin/users/:id/status` | 启用 / 禁用 / 软删 |
| PATCH | `/admin/users/:id/role` | 角色变更（最后一个 admin 保护） |
| POST | `/admin/users/:id/password` | 重置密码，返回一次性明文 |
| DELETE | `/admin/users/:id` | 物理删除（二次确认） |
| GET | `/admin/projects?keyword&userId&page&pageSize` | 项目分页 |
| DELETE | `/admin/projects/:id` | 删除项目及连带数据 |
| GET | `/admin/assets?kind&capability&userId&status&page&pageSize` | 素材分页 |
| PATCH | `/admin/assets/:id/status` | 下架 / 恢复 |
| DELETE | `/admin/assets/:id` | 删除素材及磁盘文件 |
| GET | `/admin/tasks?status&capability&provider&userId&from&to&page&pageSize` | 任务分页 |
| GET | `/admin/tasks/:id` | 任务详情（含参数与产出） |
| POST | `/admin/tasks/:id/retry` | 失败重试，返回新 taskId |
| POST | `/admin/tasks/:id/cancel` | 终止运行中任务 |
| GET | `/admin/capabilities` | 能力清单 + 调用量 + 成功率 |
| PATCH | `/admin/capabilities/:id` | 改 mode / enabled |
| GET | `/admin/channel` | 通道状态（脱敏）与各能力路由 |
| PUT | `/admin/channel/route` | 设置单能力路由 / 全局开关 |
| POST | `/admin/channel/test` | 真实探测网关 |
| GET | `/admin/settings` | 全部设置（分组） |
| PUT | `/admin/settings` | 批量写设置 |
| GET | `/admin/storage` | uploads 占用统计 |
| GET | `/admin/audit-logs?actorId&action&page&pageSize` | 审计分页 |
| GET/POST/PATCH | `/admin/products`、`/admin/products/:id/prices` | 商品与消耗价（commerce 追加，详见 commerce §8.2） |
| GET/POST | `/admin/orders`、`/admin/orders/:orderNo/{mark-paid,refund}` | 订单管理（commerce 追加） |
| GET/POST | `/admin/credits/users`、`/admin/credits/users/:userId/{lots,adjust}` | 积分账本（commerce 追加） |
| GET | `/admin/payments`、`/admin/finance/summary` | 支付流水与财务概览（commerce 追加） |

统一响应信封、错误码规范全部沿用现有 `ResponseInterceptor` + `AppError`。

---

## 8. 前端落地方案

| 层 | 方案 |
|---|---|
| 路由 | `App.tsx` 在 `Shell` 之外新增 `/admin/*` 分支。**注意现有 `<Route path="*" element={<Shell />} />`（`App.tsx:348`）会吞掉所有路径**，admin 路由必须注册在它之前 |
| 外壳 | 新建 `components/admin/AdminLayout.tsx`（antd `Layout`：`Sider` + `Header` + `Content`），不引入 `AppLayout` / `SideRail` / `PromoBar` |
| 状态 | `AuthContext` 增加 `user.role`（登录响应已带 `user`，仅需扩类型与存储） |
| 请求 | `lib/api.ts` 新增 `adminApi` 分组，复用现有 `request()`（已处理信封剥离与 401 广播） |
| 类型 | `types/api.d.ts` 追加 `Admin*` 类型段 |
| 样式 | 只用 `global.css` 已有 token（`--surface` `--border` `--text-body` `--brand` `--radius-card`），不新增裸 hex |
| 页面 | `pages/admin/` 下 12 个文件（8 基础 + commerce 追加 4），全部 lazy 加载，接现有 `ErrorBoundary` |
| 交易域 | commerce 追加：`pages/{CreditsPage,OrdersPage,CheckoutPage}.tsx` + `admin/{ProductsPage,OrdersPage,CreditsPage,PaymentsPage}.tsx` |

---

## 9. 批次划分

| 批次 | 内容 | 产出 | 依赖 |
|---|---|---|---|
| **A1** | schema 扩列 + 3 张新表 + `AdminGuard` + `seed-admin.ts` + `RequireAdmin` + `AdminLayout` 空壳 + 一条可达路由 | 管理端能进、越权被拦 | — |
| **A2** | 平台概览 + 用户管理（含禁用/角色变更） | 后台第一批真实可用 | A1 |
| **A3** | 项目 / 素材 / 任务监控（含重试、终止） | 运营日常动作闭环 | A1 |
| **B1** | 能力与通道（override 合并进 `/capabilities` 下发 + 通道测试） | 配置能力 | A2 |
| **B2** | 系统设置（含维护模式）+ 操作审计 | 配置与可追溯 | A2 |
| **C1** | 独立审计存储 / hash 链、防篡改 | 加固 | B2 |

commerce 链路的 K1–K4 批次见 `docs/commerce-design.md` §10（K1 积分账本 → K2 商品 → K3 订单+沙箱支付 → K4 后台 4 模块），K4 依赖本文档 A1。

每批完成需过：`npm run prisma:push` → `npm run build` → `npm run typecheck` → 越权用例（C 端 token 打 admin 接口必须 403）。

---

## 10. 明确不做（防范围蔓延）

| 不做 | 理由 |
|---|---|
| ~~计费 / 积分 / 订单后台~~ | **已改判为做**，见 `docs/commerce-design.md`。原理由（无业务表）已由 commerce 新建 6 表解决 |
| 真实微信 / 支付宝通道对接 | 无商户号与证书；只做接口抽象 + 沙箱，凭据到位另开批次（commerce §10 K5） |
| 积分提现 / 转赠 | 涉及资金出账与风控，非 MVP 范围 |
| 内容审核工单 / 举报 / 申诉 | 素材库全私有，无公开 UGC |
| 自定义角色 / 权限矩阵 / RBAC | 只有两级角色，YAGNI |
| 消息推送 / 站内信 / 邮件 | 无触达体系 |
| 多语言后台 | 主语言中文 |
| 数据导出 CSV / 定时报表 | 无需求证据，P2 再议 |
| 操作审计不可删 | 已内置（只读页 + 无 delete 接口） |

---

## 11. 未决项（需裁定后才动代码）

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 管理员账号怎么产生？ | 跑 `npm run seed:admin` 生成随机 16 位密码并打印一次；不落在任何前端常量里 |
| 2 | `admin@demo.com` 是否给 admin 角色？ | **不给**。它是前端硬编码的公开演示凭据，给 admin 等于公开后台入口 |
| 3 | 素材「下架」是否值得改 C 端列表？ | 值得，但要单列批次做，避免混进 A3 |
| 4 | 维护模式做到什么程度？ | MVP 只拦生成接口（503），不改只读页面 |
| 5 | 管理端是否需要独立域名/端口？ | MVP 同域 `/admin` 即可；上生产再拆（拆时只需加 Nginx 路由） |

---

## 附录 · 与现有模块的改动接触面

| 文件 | 改动 | 批次 |
|---|---|---|
| `backend/prisma/schema.prisma` | User 扩 3 列 + 3 张新表 | A1 |
| `backend/src/common/admin.guard.ts` | 新增 | A1 |
| `backend/src/admin/` | 新增模块（controller/service/dto） | A1–B2 |
| `backend/src/app.module.ts` | 注册 `AdminModule` | A1 |
| `backend/src/auth/auth.service.ts` | JWT 带 role、登录写 `lastLoginAt` | A1 |
| `backend/src/assets/assets.service.ts` | 用户端列表过滤 `status='visible'` | A3（仅当裁定采纳下架） |
| `backend/src/capabilities/capabilities.controller.ts` | 合并 override 后下发 | B1 |
| `backend/scripts/seed-admin.ts` | 新增 | A1 |
| `frontend/src/App.tsx` | admin 路由分支 + `RequireAdmin` | A1 |
| `frontend/src/components/admin/*` | 新增 | A1 |
| `frontend/src/pages/admin/*` | 新增 8 页 | A2–B2 |
| `frontend/src/lib/api.ts` | 新增 `adminApi` | A2 |
| `frontend/src/types/api.d.ts` | 新增 admin 类型段 | A2 |
| `frontend/src/context/AuthContext.tsx` | 存 `role` | A1 |