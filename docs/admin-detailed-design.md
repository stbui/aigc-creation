# 货觉AI · 后台功能详细设计

版本 v1.0 ｜ 2026-10-19 ｜ 上游：`docs/admin-prd.md`（需求）

本文描述**怎么做**，不重复**做什么**。每个模块给出页面结构、组件、数据流、接口、边界处理。

视觉与布局见 `docs/admin-ui-design.md`。

> **实现进度**（2026-10-19 更新）
> - M2 骨架已落地：§0 通用设计 + §1 登录与权限 + §2 平台概览
> - M4 用户管理已落地：§3 用户管理（列表/详情/禁用/角色/重置密码/删除）
> - M10 角色权限 + 操作审计已落地：§16 操作审计、§2 RBAC
> - M14 系统设置已落地：§3.15 系统设置（分组/校验/运行时覆盖）
> - M5 素材管理已落地：B-21~27 + 多存储后端（local/OSS/MinIO 抽象层）
> - M6/M7/M8 交易域已落地：积分账本 / 商品 SKU / 订单与沙箱支付 / 退款
> - M11 营销中心已落地：B-64 优惠券 / B-65 限时活动 / B-66 邀请规则 / B-67 签到规则
> - M9.5 调度器已落地：B-90 订单超时关闭 / 积分到期回收 / 备份 / 保留期清理，
>   含执行状态上报与手动触发（仅幂等任务，详见 `src/admin/scheduler.service.ts`）
> - M16 数据安全已落地：B-96 定时备份 / B-97 恢复验证 / B-98 备份列表与手动备份 /
>   B-100 到期数据清理（详见 `src/admin/backup.service.ts` 顶部注释）
> - 其余模块待后续批次。

> **实现进度**（2026-10-19 更新）
> - M2 骨架已落地：§0 通用设计 + §1 登录与权限 + §2 平台概览
> - M4 用户管理已落地：§3 用户管理（列表/详情/禁用/角色/重置密码/删除）
> - M10 角色权限 + 操作审计已落地：§16 操作审计、§2 RBAC
> - M14 系统设置已落地：§3.15 系统设置（分组/校验/运行时覆盖）
> - M5 素材管理已落地：B-21~27 + 多存储后端（local/OSS/MinIO 抽象层）
> - M6/M7/M8 交易域已落地：积分账本 / 商品 SKU / 订单与沙箱支付 / 退款
> - M11 营销中心已落地：B-64 优惠券 / B-65 限时活动 / B-66 邀请规则 / B-67 签到规则
> - M9.5 调度器已落地：B-90 订单超时关闭 / 积分到期回收 / 备份 / 保留期清理，
>   含执行状态上报与手动触发（仅幂等任务，详见 `src/admin/scheduler.service.ts`）
> - M16 数据安全已落地：B-96 定时备份 / B-97 恢复验证 / B-98 备份列表与手动备份 /
>   B-100 到期数据清理（详见 `src/admin/backup.service.ts` 顶部注释）
> - 其余模块待后续批次。

---

## 0. 通用设计

### 0.1 目录结构

```
backend/src/admin/
├── admin.module.ts
├── admin.guard.ts              # role + status 实时校验
├── permission.guard.ts         # 权限点校验（@RequirePermission）
├── permission.decorator.ts     # @RequirePermission('user.write')
├── audit.interceptor.ts        # 写操作审计（自动埋点）
├── shared/
│   ├── paginate.ts             # 分页 DTO + 查询助手
│   └── export.ts               # 游标分页 CSV 导出
├── overview/
├── users/
├── projects/
├── assets/
├── tasks/
├── capabilities/
├── products/
├── orders/
├── payments/
├── credits/
├── compliance/
├── marketing/
├── messages/
├── tickets/
├── settings/
├── audit-logs/
├── datatools/
└── credentials/

frontend/src/
├── components/admin/
│   ├── AdminLayout.tsx
│   ├── AdminSider.tsx
│   ├── AdminHeader.tsx
│   ├── PageHeader.tsx
│   ├── FilterBar.tsx
│   ├── DetailDrawer.tsx       # 统一详情抽屉
│   ├── ConfirmAction.tsx      # 高危二次确认
│   └── StatCards.tsx
├── hooks/admin/
│   ├── useAdminList.ts        # 列表数据 hook（分页/筛选/刷新）
│   └── usePermission.ts       # 权限判断 hook
└── pages/admin/                # 20 个页面
```

### 0.2 守卫链

```ts
// admin.module.ts 级别挂一次
providers: [
  { provide: APP_GUARD, useClass: AdminGuard },
  { provide: APP_GUARD, useClass: PermissionGuard },
  { provide: APP_GUARD, useClass: AuditInterceptor },
]
```

| 守卫 | 职责 | 拒绝响应 |
|---|---|---|
| `AdminGuard` | 校验 Bearer token；查库取 role 与 status | 401 未认证 / 403 非管理员 / 403 账号已禁用 |
| `PermissionGuard` | 读 `@RequirePermission` 元数据，比对 `AdminRole.permissions` | 403 无权限（不回显所需权限名） |
| `AuditInterceptor` | 拦截非 GET，异步写 `AdminAuditLog` | 不阻断业务（审计失败仅告警） |

**关键**：`AdminGuard` 每次请求查库。SQLite 本地单文件，admin 接口低频，开销可忽略；换来的是降权/禁用后旧 token 立即失效。

### 0.3 权限点命名

```
<模块>.<动作>

platform.dashboard    user.read  user.write  user.disable  user.delete  user.reset_password
project.read  project.delete
asset.read  asset.hide  asset.delete
task.read  task.retry  task.cancel
product.read  product.write  product.price  product.publish
order.read  order.mark_paid  order.refund
payment.read  finance.dashboard  invoice.write
credit.read  credit.adjust
compliance.read  compliance.gate  compliance.takedown
capability.read  capability.write  channel.route  channel.test
marketing.write  message.write  ticket.handle
setting.read  setting.write  role.write  audit.read
data.export  data.import  data.batch  data.search
backup.read  backup.run  content.read
```

### 0.4 列表页通用模式

```tsx
// hooks/admin/useAdminList.ts
interface AdminListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  filters?: Record<string, string | undefined>;
}

export function useAdminList<T>(fetcher: (p: AdminListParams & { signal: AbortSignal }) => Promise<ListResult<T>>, deps: unknown[]) {
  const [data, setData] = useState<ListResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<AdminListParams>({ page: 1, pageSize: 20 });

  // 请求竞态处理：AbortController + 请求序号校验，避免慢响应覆盖新响应
  // 失败时保留上一次数据不清空，避免页面闪烁为空白
  return { data, loading, error, params, setParams, reload: () => setParams(p => ({ ...p })) };
}
```

**约定**：
- 分页 `page` 从 1 开始，`pageSize` 默认 20，可选 20/50/100
- 筛选变更时 `page` 重置为 1
- 列表为空与加载失败区分：空显示 `Empty`，失败显示 `Result` + 重试按钮

### 0.5 详情抽屉统一模式

```tsx
<DetailDrawer open={detailId != null} onClose={...} title="..." width={720} loading={...} error={...}>
  {/* 内容区：Descriptions 基础信息 + 自定义区块 */}
</DetailDrawer>
```

**约定**：抽屉打开时才发详情请求（懒加载），关闭时清空缓存；同一 id 重复打开不重复请求。

### 0.6 高危操作二次确认

```tsx
<ConfirmAction
  danger
  title="删除用户"
  impactText="将同时删除该用户的 12 个项目、45 张素材、89 条任务记录，且不可恢复"
  requireTyping                            // 财务与删除类需输入确认词
  typingText="删除"
  onConfirm={...}
/>
```

`requireTyping` 用于：`user.delete` `asset.delete` `order.refund` `credit.adjust` `setting.write`。

### 0.7 审计拦截器

```ts
// 只审计写操作；detail 从 body 提取
const AUDITABLE = ['POST', 'PATCH', 'PUT', 'DELETE'];

// 高危动作补充「操作原因」字段校验
const REQUIRE_REASON = new Set([
  'user.delete', 'credit.adjust', 'order.refund',
  'setting.write', 'capability.write', 'compliance.takedown',
]);
```

审计写入**异步且不阻断业务**：审计失败只打 WARN 日志，不能因为审计表写失败导致用户操作失败。

### 0.8 分页后端助手

```ts
// shared/paginate.ts
export interface PageQuery {
  page?: number;      // 默认 1
  pageSize?: number;  // 默认 20，上限 100
  sort?: string;      // "createdAt:desc"
}

export function buildPage(query: PageQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
```

### 0.9 导出

导出走独立端点，不复用列表端点：

```
GET /admin/<模块>/export?筛选参数  →  text/csv; charset=utf-8
Content-Disposition: attachment; filename="users-20261019.csv"
```

CSV 加 UTF-8 BOM，避免 Excel 打开中文乱码。游标分页逐批读，不一次性载入内存。

### 0.10 前端权限 hook

```ts
// hooks/admin/usePermission.ts
export function usePermission() {
  const { role } = useAuth();
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return {
    can: (p: string) => permissions.includes(p),
    canAny: (...ps: string[]) => ps.some(p => permissions.includes(p)),
  };
}
```

前端 `can()` 只用于**隐藏无权操作的按钮**，不能作为安全边界 —— 真正的校验在后端守卫。

---

## 1. 登录与权限（M2）

### 1.1 页面

| 路由 | 页面 | 内容 |
|---|---|---|
| `/admin/login` | 后台登录 | 邮箱密码，失败显示剩余尝试次数 |
| `/admin` | 重定向 | → `/admin/dashboard` |
| `/admin/roles` | 角色权限矩阵 | 三角色 × 权限点网格，只读展示 + 权限开关 |

后台复用 C 端 token（同一 `AuthContext`）。若当前用户非 admin/operator/finance，访问 `/admin/*` 时 `RequireAdmin` 组件跳回 `/workbench` 并 toast。

### 1.2 AdminLayout

```
┌─────────────────────────────────────────────┐
│ Header: logo · 环境标识 · 当前用户 · 角色标签 │  56px
├──────────┬──────────────────────────────────┤
│ Sider    │ Content                          │
│ 240px    │  (Outlet)                        │
│ 分组菜单 │                                  │
│ 底部:角色│                                  │
└──────────┴──────────────────────────────────┘
```

Sider 分组（按权限过滤后渲染）：

| 组 | 菜单项 |
|---|---|
| 总览 | 平台概览 |
| 运营 | 用户管理、项目与素材、任务监控 |
| 交易 | 商品管理、订单管理、支付与财务、积分账本 |
| 增长 | 营销中心、消息中心、工单中心 |
| 系统 | 合规中心、能力与通道、数据安全、内容安全、系统设置、角色权限、操作审计 |

**环境标识**：Header 右侧显示 `生产` / `预发` / `开发` 徽标，取自 `VITE_ENV`。防止误在生产环境执行测试操作。

### 1.3 角色权限页

只读矩阵展示三个内置角色的权限点，可勾选调整。**内置角色不可删除**（`AdminRole.builtIn = true`），仅权限点可改。

修改权限点时：立即生效（守卫每次请求查库），并写入审计。

### 1.4 边界

| 场景 | 处理 |
|---|---|
| 演示账号 `admin@demo.com` | 不授予任何后台角色。登录后台时提示「该账号无后台权限」 |
| 最后一个 admin 被降级 | 409「至少保留一个管理员」 |
| 角色权限被清空 | 该角色登录后台可见模块为空，提示「当前角色未分配任何权限」 |
| token 过期 | 401 → 清 token → 跳后台登录页并携带原路径 |

---

## 2. 平台概览（M4）

### 2.1 页面结构

```
PageHeader「平台概览」 + 时间范围切换（7天/30天/90天）
├─ StatCards (6 张)
│   用户总数 / 新增用户 / 项目数 / 素材量 / 任务总数 / 成功率
├─ 图表区 (2 列)
│   ├─ 任务趋势折线（按日）
│   └─ 状态分布饼图（pending/running/succeeded/failed）
├─ 列表区 (2 列)
│   ├─ 能力使用 Top 10（横向条 + 成功率）
│   └─ 失败能力 Top 5（含最近 errorCode）
└─ 最近任务表（20 条，含缩略图）
```

### 2.2 接口

```
GET /admin/overview?days=7
GET /admin/overview/trend?days=30
```

### 2.3 数据聚合

单次请求内 `Promise.all` 并行：

| 指标 | 来源 |
|---|---|
| 用户总数 / 新增 | `user.count()` + `user.count({ createdAt: { gte } })` |
| 项目数 | `project.count()` |
| 素材量 | `asset.groupBy({ by: ['kind'] })` |
| 任务统计 | `generationTask.groupBy({ by: ['status'] })` |
| 能力分布 | `groupBy({ by: ['capability'] })` + join registry 取名称与 mode |
| 通道占比 | `groupBy({ by: ['provider'] })` |
| 趋势 | `findMany({ select: { createdAt, status } })` 后在内存按日聚合 |

**注意**：趋势数据量大时不用 `groupBy`（SQLite 日期分组支持有限），改为取时间戳在 Node 侧聚合。7 天约 ≤ 数千条，可接受；超过 30 天建议加日汇总表。

### 2.4 图表

用 ECharts 或 Recharts（择一，全站统一）。图表颜色一律取 `global.css` 的 token 值，禁止硬编码。

### 2.5 边界

| 场景 | 处理 |
|---|---|
| 新系统无数据 | StatCards 显示 0，图表显示空态文案，不报错 |
| 交易域未上线 | 营收相关卡片**不渲染**（不是显示 0） |
| 某能力名称变更 | join registry 失败时降级显示 capability id |
| 统计超时 | 卡片独立加载，单个失败不影响其他卡片 |

---

## 3. 用户管理（M4）

### 3.1 列表

**筛选**：关键词（邮箱模糊）、角色、状态、注册时间范围

**列**：邮箱 · 昵称 · 角色 Tag · 状态 Tag · 注册时间 · 最近登录 · 项目数 · 任务数 · 素材数 · 操作

**列宽与对齐**：邮箱左对齐，计数右对齐，状态与角色用 Tag 居中。

**操作**：详情 · 禁用/启用 · 角色变更 · 重置密码 · 删除

### 3.2 接口

```
GET    /admin/users?keyword&role&status&from&to&page&pageSize&sort
GET    /admin/users/:id
PATCH  /admin/users/:id/status   { status }
PATCH  /admin/users/:id/role     { role }
POST   /admin/users/:id/password
DELETE /admin/users/:id
GET    /admin/login-logs?userId&page
```

### 3.3 详情抽屉

```
用户基本信息（邮箱/昵称/角色/状态/注册/最近登录/IP）
├─ 统计卡：项目数 · 任务数 · 素材数 · 累计消费积分
├─ 最近任务表（20 条：能力/状态/时间/缩略图）
├─ 最近素材网格（20 张缩略图）
├─ 积分概览（余额 · 即将过期 · 累计消费）
├─ 订单列表（有则显示，最多 10 条）
└─ 登录日志（最近 10 条）
```

### 3.4 禁用与启用

```ts
// 禁用时连带使当前 token 失效
async disable(userId: string) {
  await this.prisma.user.update({
    where: { id: userId },
    data: { status: 'disabled', disabledAt: new Date(), disabledBy: currentAdminId },
  });
  // 附加列需加：disabledAt DateTime? / disabledBy String?
}
```

由于 `AdminGuard` 每次查库校验 status，被禁用用户**下一次请求即 403**，无需额外的 token 黑名单。

### 3.5 角色变更

```
校验链：
1. target.role !== 'admin' 时，允许改为任意后台角色
2. target.role === 'admin' 时，改前检查系统内是否还有其他 admin → 无则 409
3. actor.role !== 'admin' 时，禁止改为 'admin'（防提权）
```

### 3.6 重置密码

生成 16 位随机密码（大小写字母 + 数字），bcrypt 哈希后写入。**明文仅在响应中返回一次**，前端弹窗展示并提示「关闭后不可再次查看」。

### 3.7 删除用户

**软删优先**：默认 `status = 'deleted'`，保留数据（订单受 3 年留存约束不能删）。

**物理删除**需二次确认，界面必须列出将删除的量：

```
将永久删除：
- 12 个项目
- 45 张素材（含磁盘文件）
- 89 条任务记录
- 8 条积分流水
订单与支付记录将保留（法定留存 3 年），但用户信息将匿名化。

此操作不可恢复。请输入「删除」确认。
```

### 3.8 匿名化处理

物理删除时：
- `User.email` → `deleted_{userId}@anonymized.local`
- `User.name` → `已注销用户`
- `User.passwordHash` → 置空
- 素材与任务保留，但用户关联改为 null 或指向占位记录

### 3.9 边界

| 场景 | 处理 |
|---|---|
| 关键词搜索大邮箱前缀 | `%keyword%` 走不到索引。加 `LIKE 'keyword%'` 前缀匹配优先 |
| 用户无任何项目 | 详情抽屉统计卡显示 0，列表隐藏操作 |
| 禁用自己 | 禁止（403），避免误操作锁死 |
| 删除当前登录用户 | 禁止 |
| 批量禁用 | 每条独立事务与审计，一条失败不回滚其他 |

---

## 4. 项目与素材（M5）

### 4.1 项目列表

**筛选**：关键词、所属用户、时间范围

**列**：项目名 · 所属用户 · 素材数 · 任务数 · 创建时间 · 操作（删除）

删除确认文案列出连带量。

### 4.2 素材列表

**筛选**：kind（original/generated）· capability · 所属用户 · 所属项目 · 状态（visible/hidden）· 时间范围

**视图切换**：网格（缩略图墙）/ 表格

**网格**：缩略图 + hover 显示能力名与时间 + 快捷操作（下架、删除、查看大图）

**列**：缩略图 · kind · capability（join registry）· 尺寸 · 格式 · 大小 · 所属项目 · 用户 · 上传时间 · 操作

### 4.3 接口

```
GET    /admin/projects?keyword&userId&from&to&page&pageSize
DELETE /admin/projects/:id
GET    /admin/assets?kind&capability&userId&projectId&status&page&pageSize&view
PATCH  /admin/assets/:id/status    { status }
DELETE /admin/assets/:id
GET    /admin/assets/:id/file       # 鉴权后返回文件流
```

### 4.4 素材文件访问

现有 `main.ts:49` 用 `useStaticAssets` 直挂本地目录，**无鉴权**。改为：

```ts
@Get('assets/:id/file')
async file(@Param('id') id: string, @Res() res: Response) {
  const asset = await this.prisma.asset.findUnique({ where: { id } });
  if (!asset) throw new AppError(40400, '素材不存在', 404);
  const path = join(process.cwd(), ...asset.sourceUrl.split('/'));
  // 签名校验已在 AdminGuard 前置，或此处校验短时效 token
  res.sendFile(path);
}
```

前端图片地址改为 `/api/v1/admin/assets/:id/file`，而非 `/uploads/xxx`。

C 端素材访问另行实现短时效签名 URL（M4.5），不在本文范围。

### 4.5 下架与恢复

```
PATCH /admin/assets/:id/status  { status: 'hidden' | 'visible' }
```

下架后：
- C 端素材库列表过滤 `status = 'visible'`
- C 端作品页的图片访问返回 404
- 磁盘文件**不删除**，仅隐藏，便于恢复与举证

### 4.6 边界

| 场景 | 处理 |
|---|---|
| 素材文件已被清理 | 缩略图显示占位图，详情标注「文件已丢失」 |
| capability 为 null 的素材 | 显示「—」，不 join registry |
| 删除有产出的素材 | 连带删除其产出任务（`outputOfTask` 1:1 关系） |
| 删除项目的连带量过大 | 超过阈值（如 1000 条）时要求二次确认并异步执行 |
| 缩略图加载慢 | 网格用懒加载 + 骨架占位 |
---

## 5. 任务监控（M5）

### 5.1 列表

**筛选**：状态 · 能力 · 通道（gateway/local）· 用户 · 时间范围 · 项目

**列**：任务 ID（短 hash）· 能力 · 状态 Tag · 通道 Tag · 用户 · 项目 · 耗时 · 创建时间 · 操作

**顶部统计条**：pending 数、running 数（>50 标红告警）、近 1 小时失败数。

### 5.2 接口

```
GET  /admin/tasks?status&capability&provider&userId&projectId&from&to&page&pageSize
GET  /admin/tasks/:id
POST /admin/tasks/:id/retry
POST /admin/tasks/:id/cancel
```

### 5.3 详情抽屉

```
任务概要（ID / 能力 / 状态 / 通道 / 耗时 / errorCode）
├─ 输入素材缩略图（多图按 inputAssetIds 顺序排列）
├─ 产出图大图预览
├─ 参数 JSON（<pre> 格式化，可折叠）
└─ 状态流转时间线（创建 → 开始 → 完成/失败）
```

参数 JSON 渲染：`JSON.stringify(params, null, 2)`，超长时默认折叠并提供「展开」。

### 5.4 耗时计算

`GenerationTask` 有 `createdAt` 与 `updatedAt`，耗时 = `updatedAt - createdAt`。毫秒级任务显示 `123ms`，分钟级显示 `2分15秒`。

### 5.5 重试

```ts
async retry(taskId: string) {
  const origin = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!origin) throw new AppError(40400, '任务不存在', 404);
  if (origin.status !== 'failed') throw new AppError(40000, '仅失败任务可重试', 400);

  // 新建任务，不复用原 id（outputAssetId 有 1:1 唯一约束）
  const next = await this.prisma.generationTask.create({
    data: {
      projectId: origin.projectId,
      ownerId: origin.ownerId,
      capability: origin.capability,
      status: 'running',
      inputAssetIds: origin.inputAssetIds,
      params: origin.params,
      provider: 'mock',
      creditCost: origin.creditCost,
      retriedFromId: origin.id,      // 附加列，记录来源任务
    },
  });
  setImmediate(() => void this.generateService.processTask(next.id));
  return { taskId: next.id };
}
```

**不原地复活的原因**：`GenerationTask.outputAssetId` 是 `@unique` 的 1:1 关系，原地复活会导致新的产出图与旧的产出图冲突。

### 5.6 终止

```ts
async cancel(taskId: string) {
  await this.prisma.generationTask.update({
    where: { id: taskId },
    data: { status: 'failed', errorCode: 'cancelled_by_admin', updatedAt: new Date() },
  });
}
```

**已知限制**：当前 `processTask` 在 `setImmediate` 中执行且无取消检查点，终止只改数据库状态，实际计算会继续跑完并可能覆盖产出。彻底解决需要给 `processTask` 加 AbortSignal，中优先级改进项。

### 5.7 边界

| 场景 | 处理 |
|---|---|
| 输入素材已被删除 | 缩略图显示「已删除」，仍可查看参数 JSON |
| 任务 ID 太长 | 列表只显示后 8 位，hover 显示完整 |
| 并发操作同一任务 | 后端二次校验状态，条件更新 `where: { id, status: 'failed' }` |
| 批量重试失败任务 | 上限 100 条/次，超出需分批 |

---

## 6. 商品管理（M7 / M9）

### 6.1 列表

**列**：SKU · 名称 · 类型 Tag（订阅卡/加油包）· 价格（现价 + 划线价）· 积分数 · 有效期 · 发放方式 · 状态 Switch · 排序 · 操作

**筛选**：类型 · 状态 · 关键词

### 6.2 编辑表单

| 字段 | 类型 | 校验 |
|---|---|---|
| sku | string | 正则 `^[a-z0-9_]+$`，创建后不可改 |
| name | string | 必填，≤ 30 字 |
| type | enum | `subscription` \| `addon` |
| priceCents | int | > 0。UI 输入元，展示时转 `¥xx.xx` |
| originalPriceCents | int? | 可选，> priceCents 时提示「划线价应高于现价」 |
| credits | int | > 0 |
| creditsValidDays | int | `0` = 永久；> 0 必填 |
| grantPlan | enum | `once` \| `monthly` \| `none` |
| features | string[] | 卖点列表，仅展示，**必须与实际能力一致** |
| badge | string? | 角标文案 |
| sort | int | 越小越靠前 |
| status | enum | `on` \| `off` |

### 6.3 消耗价配置

独立页面 `/admin/products/:sku/pricing`：

```
┌──────────────────────────────────────────┐
│ 能力消耗价                [批量设置] [保存] │
├──────────────────────────────────────────┤
│ 能力          分组     消耗积分  限时免费  │
│ 商品主图      电商生图   [ 10 ]   [  ]    │
│ 商品详情图    电商生图   [ 10 ]   [  ]    │
│ 一键抠图      AI修图     [ 0 ]    [✓]    │
│ ...                                     │
└──────────────────────────────────────────┘
```

保存后写入 `SystemSetting['creditPrice.<capabilityId>']`。见 §5.4 的优先级解析。

### 6.4 权益声明一致性校验

⚠️ 现有落地页订阅卡声明了 5 类权益，其中 4 类无数据模型承载。商品编辑页必须约束：

| 权益类型 | 是否有载体 | 处置 |
|---|---|---|
| 可生成 N 张图片 | ✅ 由 `credits ÷ 单次消耗` 推导 | 允许，且与消耗价联动校验 |
| 送 N 次 AI 修图 | ❌ | **禁止填写**（表单不提供该字段） |
| 专享通道 | ❌ | 禁止 |
| 并发多任务 | ❌ | 禁止 |
| 加油包折扣 | ❌ | 禁止 |

**若确需实现**：须新增 `ProductEntitlement` + `UserEntitlement` 两表并落地限分辨率、并发、折扣三个能力。本期不做。

`features` 字段改为**受控选项**而非自由文本，避免再次出现无载体的承诺文案。

### 6.5 接口

```
GET    /admin/products?type&status&keyword&page
GET    /admin/products/:id
POST   /admin/products
PATCH  /admin/products/:id
DELETE /admin/products/:id
GET    /admin/products/:id/pricing
PUT    /admin/products/:id/pricing
GET    /admin/credit-prices            # 全站基准消耗价
PUT    /admin/credit-prices
```

### 6.6 上下架

`status` 切换即时生效：下架后 C 端商品列表不再展示，已购订单不受影响。

### 6.7 边界

| 场景 | 处理 |
|---|---|
| 删除有历史订单的 SKU | **禁止删除**，只能下架。历史订单的 `OrderItem` 已有快照，不依赖 SKU |
| 积分改为 0 | 允许（赠送活动），但提示「用户下单后无积分到账」 |
| 有效期改为 0 | 从「永久」变为「永久」，需确认是否误操作 |
| 消耗价低于历史 | 不影响历史订单（快照） |
| 并发改价 | 后端条件更新 `where: { id, updatedAt }`，冲突返回 409 |
| 划线价低于现价 | 表单校验拦截 |

---

## 7. 订单管理（M8 / M9）

### 7.1 列表

**筛选**：状态 · 用户 · 支付渠道 · 时间范围 · 订单号

**列**：订单号 · 用户 · 商品快照摘要 · 金额 · 状态 Tag · 渠道 Tag · 创建时间 · 支付时间 · 操作

### 7.2 状态机

```
created ──支付发起──> paying ──回调成功──> paid ──发积分──> fulfilled
   │                    │
   │                    ├──回调失败/关闭──┘
   ├──用户取消──> cancelled
   └──超时(15min)──> expired

fulfilled ──后台退款──> refunded
```

| 状态 | Tag 颜色 | 说明 |
|---|---|---|
| created | 默认 | 已创建未支付 |
| paying | 处理中 | 等待支付结果 |
| paid | 蓝 | 已支付待发积分 |
| fulfilled | 绿 | 已完成，积分已到账 |
| expired | 默认 | 超时关闭 |
| cancelled | 默认 | 用户取消 |
| refunded | 红 | 已退款 |

### 7.3 详情抽屉

```
订单概要（订单号 / 状态 / 金额 / 渠道 / 时间线）
├─ 商品快照（名称/价格/积分/有效期，均为下单时快照）
├─ 积分批次（发放的 CreditLot，含到期日与剩余量）
├─ 关联流水（CreditLedger）
├─ 支付信息（渠道 / 交易号 / 回调原文）
└─ 状态流转记录
```

### 7.4 接口

```
GET  /admin/orders?status&userId&channel&from&to&orderNo&page
GET  /admin/orders/:orderNo
POST /admin/orders/:orderNo/mark-paid    # 手工核销
POST /admin/orders/:orderNo/refund       { reason }
POST /admin/orders/:orderNo/cancel
```

### 7.5 手工核销

用于线下已收款但线上未回调的补偿场景。执行时：

1. 校验订单状态为 `created` 或 `paying`
2. 置 `payChannel = 'manual'`，`paidAt = now`
3. 触发发积分逻辑（与正常支付回调同一函数）
4. 强制填写原因，写审计

### 7.6 退款

```ts
async refund(orderNo: string, reason: string) {
  const order = await this.prisma.order.findUnique({ where: { orderNo } });
  if (order.status !== 'fulfilled') throw new AppError(40000, '仅已完成订单可退款', 400);

  // 按批次剩余量扣回，已消耗的部分按比例扣
  const lots = await this.prisma.creditLot.findMany({
    where: { orderId: order.id },
    orderBy: { expireAt: 'asc' },
  });

  let remaining = order.totalCredits;
  const adjustments = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remainingCredits, remaining);
    await this.prisma.creditLot.update({
      where: { id: lot.id },
      data: { remainingCredits: { decrement: take } },
    });
    await this.prisma.creditLedger.create({
      data: { userId: order.userId, lotId: lot.id, type: 'refund', amount: -take, refType: 'order', refId: order.id, note: reason },
    });
    remaining -= take;
    adjustments.push({ lotId: lot.id, taken: take });
  }

  // 用户已消耗部分无法扣回时，记录欠账
  if (remaining > 0) {
    await this.prisma.creditLedger.create({
      data: { userId: order.userId, type: 'adjust', amount: -remaining, refType: 'order', refId: order.id, note: `退款扣回不足，剩余 ${remaining} 积分` },
    });
  }

  await this.prisma.order.update({ where: { orderNo }, data: { status: 'refunded', refundedAt: new Date() } });
  return { adjustments, shortfall: remaining };
}
```

**注意**：用户已消耗的积分无法追回，这是设计取舍。退款确认弹窗必须提示「用户已消耗 X 积分，将从余额扣除；余额不足时可能产生负数」。

### 7.7 边界

| 场景 | 处理 |
|---|---|
| 重复回调支付成功 | 按 `payTransactionId` 去重，已 `paid`/`fulfilled` 直接返回成功，不重复发积分 |
| 订单号冲突 | 重试 3 次，仍冲突返回 500 并告警 |
| 退款时余额不足 | 允许负数，记录 `adjust` 流水，界面标红 |
| 定时任务未跑导致订单未过期 | 调度器每分钟检查一次；列表页显示「已超时未关闭」标红 |
| 并发退款 | 条件更新 `where: { orderNo, status: 'fulfilled' }` |

---

## 8. 支付与财务（M8 / M9 / M7.5）

### 8.1 支付流水

**列**：交易号 · 订单号 · 渠道 Tag · 金额 · 状态 · 请求时间 · 回调时间 · 耗时

**筛选**：渠道 · 状态 · 时间范围

### 8.2 对账

```
┌────────────────────────────────────────────┐
│ 对账任务                [上传渠道账单]        │
├────────────────────────────────────────────┤
│ 对账批次 #20261019                          │
│ 渠道账单 128 笔 / 本地订单 126 笔            │
│ ├─ 完全匹配 124 笔                           │
│ ├─ 渠道有本地无 2 笔   [查看]                │
│ ├─ 本地有渠道无 4 笔   [查看]  ← 可能是未支付 │
│ └─ 金额不一致 0 笔                           │
│ [导出差异清单]                              │
└────────────────────────────────────────────┘
```

对账逻辑：

```ts
// 1. 上传渠道账单 CSV → 解析（渠道不同格式不同，需适配器）
// 2. 按 transactionId 与本地 Payment 记录匹配
// 3. 分类差异：
//    - 渠道有本地无：可能支付成功但回调丢失 → 人工确认后补发积分
//    - 本地有渠道无：可能回调伪造或测试单 → 排查
//    - 金额不一致：严重异常 → 立即处理
// 4. 差异清单可导出，供财务与渠道对账
```

### 8.3 财务概览

| 指标 | 计算 |
|---|---|
| 订单数 | `order.count({ status: 'fulfilled', createdAt: { gte } })` |
| 实收金额 | `Σ priceCents`（不含 refunded） |
| 退款金额 | `Σ priceCents where status='refunded'` |
| 客单价 | 实收 / 订单数 |
| 积分消耗 | `Σ CreditLedger.amount where type='consume'` |
| 积分沉淀 | 当前所有用户可用余额之和 |

### 8.4 发票

```
用户侧：提交开票申请（抬头 / 税号 / 邮箱 / 类型）
后台侧：
  - 发票申请列表：状态（待开/已开/已寄/已作废）
  - 录入发票号码与开具日期
  - 导出开票台账
```

**依赖**：实际开票依赖税务系统或第三方开票平台。系统侧做申请受理与台账登记。

### 8.5 接口

```
GET  /admin/payments?channel&status&from&to&page
GET  /admin/finance/summary?from&to
POST /admin/finance/reconcile/upload       # 上传渠道账单
POST /admin/finance/reconcile/run          # 执行对账
GET  /admin/finance/reconcile/:batchId     # 对账结果
GET  /admin/invoices?status&page
POST /admin/invoices/:id/issue             # 录入发票信息
```

### 8.6 边界

| 场景 | 处理 |
|---|---|
| 渠道账单格式变更 | CSV 解析器按渠道分派，格式不识别时明确报错而非静默跳过 |
| 回调丢失导致积分未发 | 对账发现后人工补发，走同一发积分函数 + 审计 |
| 金额不一致 | 标记为严重异常，界面标红，禁止自动处理 |
| 对账跨月 | 支持指定日期范围，默认昨日 |
| 上传文件过大 | 限制 10MB，超过提示分文件上传 |

---

## 9. 积分账本（M6 / M9）

### 9.1 余额总览

**列**：邮箱 · 可用余额 · 即将过期（7 天内）· 累计消费 · 累计充值 · 最近变动时间 · 操作

**筛选**：关键词 · 余额区间 · 是否有即将过期积分

### 9.2 批次明细

```
用户 xxx@example.com    可用余额 2,340
┌────────────────────────────────────────────────┐
│ 批次         来源     发放      到期      剩余  │
│ order_abc   购买     2026-10-19 永久      2,000│
│ order_def   购买     2026-09-01 2026-11-01   300│ ← 即将过期
│ gift_xyz    赠送     2026-08-15 2026-08-22      0│ ← 已过期
└────────────────────────────────────────────────┘
```

### 9.3 流水

**列**：时间 · 类型 Tag · 金额（有符号，消耗为负）· 余额 · 关联对象 · 备注

**筛选**：类型 · 时间范围 · 关联对象

### 9.4 人工增减

```
调整积分

用户  [xxx@example.com     ]
类型  [赠送 ▾]
数量  [  100  ]
原因  [活动补偿                    ]  ← 必填，≤ 200 字

预览：该用户当前余额 2,340，调整后 2,440
      将创建永久有效期批次，发放 100 积分

[确认调整]   ⚠️ 此操作将写入审计日志且不可撤销
```

**规则**：
- `type` 取 `gift`（赠送）或 `deduct`（扣减）
- 正向调整创建**永久批次**（`expireAt = null`）
- 扣减时按 FEFO 从最早到期批次扣，余额不足则拒绝
- 强制填写原因，写审计

### 9.5 接口

```
GET  /admin/credits/users?keyword&from&to&page
GET  /admin/credits/users/:userId/lots
GET  /admin/credits/users/:userId/ledger?type&page
POST /admin/credits/users/:userId/adjust   { type, amount, reason }
```

### 9.6 边界

| 场景 | 处理 |
|---|---|
| 余额计算慢 | 用户维度数据量小，实时聚合 `CreditLot`；不做缓存以避免不一致 |
| 用户有大量批次 | 明细分页，批次超过 100 条时折叠展示 |
| 批量调整 | 上限 50 人/次，逐个独立事务，单个失败不影响其他 |
| 调整后余额为负 | 扣减场景直接拒绝，不允许负数 |
| 流水被误删 | 后端不提供删除接口；表设计上只允许 INSERT |

---

## 10. 合规中心（M1 / M3）

### 10.1 标识自检

```
标识自检                              [开始巡检]
─────────────────────────────────────────────
巡检范围  [最近 7 天产出图 ▾]
检查项    ☑ 显式标识存在    ☑ 隐式字段完整    ☐ 签名可验

结果
├─ 通过 1,240 张
├─ 缺显式标识 8 张      [查看列表]
├─ 缺隐式字段 3 张      [查看列表]
└─ 签名不匹配 0 张

[导出报告]
```

### 10.2 标识数据模型

```prisma
model AigcStamp {
  id         String   @id @default(cuid())
  assetId    String   @unique
  visibleMark Boolean  // 显式标识是否已注入
  metadata   String   // 隐式字段 JSON 快照
  signature  String   // sha256(assetId + STAMP_SECRET)
  injectedAt DateTime @default(now())

  @@index([injectedAt])
}
```

### 10.3 签名算法

```
signature = sha256(`${assetId}:${STAMP_SECRET}`).hex()
```

`STAMP_SECRET` 走环境变量，不入库、不下发前端。

### 10.4 内容处置

```
处置台账
────────────────────────────────────────────────
时间       对象        判定       动作     执行人
2026-10-19 a_xxx.jpg  涉政疑似   下架     admin
2026-10-18 b_yyy.jpg  正常       放行     system
────────────────────────────────────────────────
[批量处置] [导出]
```

**判定来源**：`ContentReview` 表（外部送审服务写入）。无送审服务时该表为空，界面显示「未接入内容安全服务」而非空白。

### 10.5 能力管控

```
能力管控
────────────────────────────────────────────
能力          mode      消耗  开放   限次
创意生图      mock      10   [✓]   [   ]
局部重绘      mock      10   [✓]   [   ]
一键抠图      real       0   [✓]   [✓]  ← 限时免费
图片翻译      mock      10   [   ]   [   ] ← 已关闭
```

三个开关：`enabled`（开放/关闭）、`freeMode`（限时免费）、`rateLimit`（限次）。

**关闭能力的影响**：C 端侧栏、顶导、工作台卡片均不展示；已生成的历史作品仍可查看。

### 10.6 接口

```
GET  /admin/compliance/audit?from&to&status    # 标识自检
POST /admin/compliance/audit/run               # 执行巡检
GET  /admin/compliance/reviews?from&to&decision# 送审判定
PATCH /admin/compliance/reviews/:id/action     { action, reason }
GET  /admin/compliance/capabilities            # 能力管控
PATCH /admin/compliance/capabilities/:id      { enabled, freeMode, rateLimit }
```

### 10.7 边界

| 场景 | 处理 |
|---|---|
| 产出图文件已删除 | 自检跳过，计入「文件丢失」单独统计 |
| 无送审服务 | 界面明确显示未接入，处置台账为空态说明 |
| 处置后用户申诉 | 工单中心接收，运营复核 |
| 批量下架量大 | 二次确认，异步执行，记录批次号 |

---

## 11. 能力与通道（M14）

### 11.1 能力清单

**列**：能力 · 分组 · mode Tag · 消耗积分 · 开放 Switch · 参数数 · 近 7 天调用量 · 成功率 · 操作

支持批量上下架。

### 11.2 通道配置

```
通道路由
──────────────────────────────────────────────────
范围          值        说明
全局开关      [自动 ▾]   auto | local | remote
默认模型      [       ]   留空由网关决定

单能力覆盖
能力          路由      优先级
main_image    [自动 ▾]   继承全局
matting       [本地 ▾]   强制本地
```

**优先级链**（唯一事实源不被破坏）：

```
代码 capability.registry.ts / 环境变量   ← 默认值，权威
        ↓ 运行时覆盖
SystemSetting['channel.route.<capabilityId>']
SystemSetting['channel.enabled']
SystemSetting['channel.model']
```

界面必须标注：**「此处为运行时覆盖，环境变量优先级更高，重启后仍生效」**。

### 11.3 通道测试

```
通道测试

目标地址  http://localhost:3001/api/v1
令牌      abcd****wxyz                      ← 脱敏，不可编辑
超时      120000 ms

[发起测试]

结果：
✓ 连通正常      响应 128ms
  返回：{ taskId: "xxx", status: "queued" }
  下发参数：model=xxx, prompt="...", type=image
```

**凭据不可编辑**：走部署期环境变量。界面只显示是否配置与脱敏值，避免密钥经前端传输。

### 11.4 接口

```
GET   /admin/capabilities              # 清单 + 统计
PATCH /admin/capabilities/:id          { enabled, mode }
GET   /admin/channel                   # 通道状态（脱敏）
PUT   /admin/channel/route             { enabled, model, routes }
POST  /admin/channel/test              { timeoutMs }
```

### 11.5 边界

| 场景 | 处理 |
|---|---|
| 关闭正在被使用的能力 | 允许，已生成作品不受影响 |
| 网关不可达 | 测试按钮返回明确错误，不静默失败 |
| 令牌未配置 | 显示「未配置」，测试按钮禁用 |
| mode 改为 real 但未接真实通道 | 允许（能力本身已是 real），但提示实际通道来源 |

---

## 12. 营销中心（M11）

### 12.1 优惠券

**列表**：券名 · 类型（满减/折扣/固定额）· 面额 · 使用门槛 · 适用范围 · 总量 · 已用 · 生效期 · 状态

**创建表单**：类型 → 面额 → 门槛 → 适用范围（全站/指定 SKU/新用户）→ 每人限用 → 总量 → 有效期

**核销**：下单时选券，校验门槛与范围，`Order.couponId` 记录，已用数 +1。

### 12.2 限时活动

| 类型 | 说明 |
|---|---|
| 限时价 | 覆盖 `Product.priceCents`，按时间段生效 |
| 限时免费 | 对应 `freeMode`，到期自动恢复消耗价 |
| 首页弹窗 | 配置文案与投放时段 |

**限时免费到期**：调度器每日检查，到期后恢复 `SystemSetting` 中的基准消耗价，并记录。

### 12.3 邀请分销

```
规则配置
────────────────────────────────────────────
邀请人奖励   [ 200 ] 积分
被邀请人奖励 [ 100 ] 积分
奖励发放     触发时机 [被邀请人首次付费 ▾]
```

C 端 `InvitationsPage.tsx` 已有复刻版面，当前为诚实降级（`InvitationsPage.tsx:72` 声明不提供奖励）。接入后仅换数据源与按钮行为，版面不改。

### 12.4 签到

**规则**：每日签到得基础积分；连续签到有加成（第 3/7/15 天额外奖励）。

### 12.5 接口

```
GET/POST/PATCH  /admin/coupons
GET/POST/PATCH  /admin/campaigns
GET/PUT         /admin/invites/rules
GET/PUT         /admin/checkin/rules
```

### 12.6 边界

| 场景 | 处理 |
|---|---|
| 券已发但规则修改 | 已核销订单按当时规则快照，不追溯 |
| 限时免费到期 | 调度器恢复基准价，记录变更 |
| 邀请人自己注册 | 绑定关系创建时排除（`inviterId !== inviteeId`） |
| 重复领券 | 按 `perUserLimit` 校验 |
| 活动叠加 | 限时价与优惠券不叠加，取更优的一个，界面明确 |

---

## 13. 消息中心（M12）

### 13.1 站内信

**列**：标题 · 类型 Tag · 目标用户 · 状态（草稿/已发）· 发送时间 · 阅读数

**触发器配置**：

| 事件 | 模板 | 接收人 |
|---|---|---|
| 订单支付成功 | `order_paid` | 购买者 |
| 积分到账 | `credits_granted` | 购买者 |
| 任务失败退积分 | `task_failed_refund` | 任务发起人 |
| 积分即将过期 | `credits_expiring` | 持有者 |
| 违规警告 | `violation_warning` | 违规用户 |

### 13.2 公告

发布 / 撤回 / 定时发布。支持弹窗式与页面式。

### 13.3 模板管理

变量占位符 `{{userName}}` `{{orderNo}}` `{{amount}}`。渲染时未提供的变量降级为空字符串，不报错。

### 13.4 接口

```
GET/POST        /admin/notifications
POST            /admin/notifications/broadcast
GET/POST/PATCH  /admin/announcements
GET/POST/PATCH  /admin/templates
GET/PUT         /admin/triggers
```

### 13.5 边界

| 场景 | 处理 |
|---|---|
| 模板变量缺失 | 降级为空串，记录 WARN |
| 批量群发量大 | 异步任务分批发送，避免超时 |
| 用户已注销 | 跳过发送，记录统计 |
| 重复触发同一事件 | 按事件 ID 去重（如订单 ID） |

---

## 14. 工单中心（M12）

### 14.1 列表

**列**：工单号 · 类型（报障/退款申请/申诉/咨询）· 标题 · 用户 · 优先级 · 状态 Tag · 指派人 · 创建时间 · SLA 剩余

### 14.2 状态流转

```
open ──指派──> processing ──解决──> resolved
  │                │
  └──用户关闭──> closed
```

### 14.3 详情抽屉

```
工单概要（编号/类型/优先级/状态/时间线）
├─ 用户信息（邮箱/注册时间/历史工单/消费情况）
├─ 关联对象（任务/素材/订单，可点击跳转）
├─ 对话区（用户消息 + 内部备注，用户不可见）
└─ 内部备注
```

### 14.4 退款申请的处理边界

⚠️ **工单不直接改钱**。退款申请的处理动作是「跳转订单模块执行退款」，工单只做受理与状态跟踪。

理由：两处都能改钱是缺陷，权限矩阵会失效，审计无法归因。

### 14.5 SLA

按优先级设置首响时限：

| 优先级 | 首响时限 |
|---|---|
| P0紧急 | 2 小时 |
| P1高 | 8 小时 |
| P2普通 | 24 小时 |

超时未响应在列表中标红。

### 14.6 接口

```
GET/POST         /admin/tickets
GET              /admin/tickets/:id
PATCH            /admin/tickets/:id/status
PATCH            /admin/tickets/:id/assign
POST             /admin/tickets/:id/messages
GET              /admin/tickets/:id/internal-notes
```

### 14.7 边界

| 场景 | 处理 |
|---|---|
| 工单关联对象已删除 | 显示「对象已删除」，仍可处理 |
| 用户撤回了问题 | 工单转 closed，保留记录 |
| 内部备注误发为用户消息 | 消息类型不可改，界面明确区分 |
| SLA 跨天 | 按自然小时计算，不按工作日 |

---

## 15. 系统设置（M14）

### 15.1 分组

| 分组 | 项 | 存储 |
|---|---|---|
| 站点 | 站点名称、维护模式 | `SystemSetting` |
| 上传 | 单文件大小上限、允许的类型 | `SystemSetting` |
| 生成 | 轮询上限、超时、并发任务上限 | `SystemSetting` |
| 安全 | JWT 有效期（只读）、密码策略 | `SystemSetting` |
| 法务 | 隐私政策、用户协议、账号规则、投诉举报入口 | 独立表 |

**维护模式**：开启后 C 端只读，生成接口返回 503。**不隐藏整个站点** —— 用户仍需能查看订单与申请退款。

### 15.2 法务文本版本化

```prisma
model LegalDoc {
  id        String   @id @default(cuid())
  slug      String   // user-agreement | privacy-policy | account-rules
  version   String   // v1.0
  title     String
  content   String   // Markdown
  publishedAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
}
```

用户注册时记录同意的版本号与时间（`UserAgreementLog` 或 `LegalDocAcceptance`），供举证。

### 15.3 投诉举报入口

⚠️ 现状：`LegalPage.tsx` 仅三份文档，**全站无投诉举报入口**（已 grep 确认）。

新增：
- C 端页脚与法务页提供「投诉举报」入口
- 表单：类型（举报违规内容/投诉服务/其他）· 描述 · 联系方式 · 附件
- 后台工单中心自动创建对应工单

### 15.4 接口

```
GET /admin/settings                # 分组读取
PUT /admin/settings                # 批量写
GET /admin/legal-docs
POST /admin/legal-docs             # 新建版本
POST /admin/legal-docs/:id/publish
GET /admin/complaints?status&page
```

### 15.5 边界

| 场景 | 处理 |
|---|---|
| 法务文本修改 | 走新版本，历史版本保留不覆盖 |
| 维护模式误开 | 确认弹窗 + 显式输入「维护模式」 |
| 配置项非法值 | 前后端双重校验 |
| 密码策略与现有密码冲突 | 只对新密码生效 |

---

## 16. 操作审计（M10）

### 16.1 列表

**列**：时间 · 操作人 · 角色 · action Tag · 对象类型 · 对象 ID · IP · 结果

**筛选**：操作人 · action · 时间范围 · 对象 ID

### 16.2 数据模型

```prisma
model AdminAuditLog {
  id         String   @id @default(cuid())
  actorId    String
  actorRole  String
  action     String   // user.disable / order.refund / credit.adjust ...
  targetType String
  targetId   String
  detail     String   // JSON：操作前后的关键字段
  reason     String?  // 高危动作的原因
  ip         String
  success    Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@index([actorId])
  @@index([action])
  @@index([createdAt])
  @@index([targetType, targetId])
}
```

### 16.3 审计范围

**所有** `POST` `PATCH` `PUT` `DELETE`，包括：

| 类别 | action |
|---|---|
| 用户 | `user.disable` `user.enable` `user.delete` `user.role_change` `user.reset_password` |
| 素材 | `asset.hide` `asset.show` `asset.delete` `project.delete` |
| 任务 | `task.retry` `task.cancel` |
| 商品 | `product.create` `product.update` `product.publish` `product.unpublish` `credit_price.update` |
| 订单 | `order.mark_paid` `order.refund` `order.cancel` |
| 积分 | `credit.adjust` |
| 合规 | `compliance.takedown` `compliance.gate` |
| 系统 | `setting.write` `capability.write` `channel.route` `role.write` `backup.run` |

### 16.4 不可删

**后端不提供删除接口**，表设计上只允许 INSERT。审计记录留存不少于 6 个月（按监管要求与内部风控需要）。

**已知不足**：当前管理员可直接操作数据库删除审计记录。彻底解决需独立存储或哈希链，本期不做。

### 16.5 边界

| 场景 | 处理 |
|---|---|
| 审计写入失败 | 不阻断业务，打 WARN 日志 + 告警 |
| 批量操作 | 每条独立记录，不合并 |
| detail 含敏感信息 | 写入前过滤密码哈希、令牌、凭据 |
| IP 获取 | 需配置 `trust proxy` 才能拿到真实 IP，否则取 socket 地址 |

---

## 17. 数据工具（M5.5）

### 17.1 导出

```
导出  用户列表                                       
────────────────────────────────────────────
导出范围 [当前筛选结果 ▾]
格式    [CSV]
字段    ☑ 邮箱 ☑ 昵称 ☑ 状态 ☐ 密码哈希（不可选）

[开始导出]
```

**约束**：
- 密码哈希、令牌、凭据类字段**永远不可导出**（表单不提供该选项）
- 游标分页逐批读，避免大表内存溢出
- CSV 加 UTF-8 BOM

### 17.2 导入

| 类型 | 用途 |
|---|---|
| 用户 | 批量开户（运营场景） |
| 商品 | 批量建 SKU |
| 渠道账单 | 对账用 |

导入流程：上传 → 解析校验 → 预检报告（新增/更新/冲突/错误）→ 确认导入 → 结果报告。

**预检不写库**，必须用户确认后才执行。

### 17.3 批量操作

选择多条 → 选择动作 → 二次确认 → 逐条独立事务执行 → 结果汇总（成功 N / 失败 M 及原因）。

单条失败不回滚其他条。

### 17.4 全局搜索

```
搜索框（Header 内）  [ 关键词                    ]
────────────────────────────────────────────
用户    [查看]  xxx@example.com
订单    [查看]  HJ20261019...
素材    [查看]  a_xxx.jpg
任务    [查看]  t_xxx
```

一个输入框跨四类对象，结果按类型分组，点击跳对应列表并带上筛选条件。

### 17.5 告警

| 告警项 | 阈值 | 动作 |
|---|---|---|
| 存储水位 | `uploads/` > 80% | 站内信 + 邮件 |
| 队列积压 | pending > 50 | 站内信 |
| 通道连续失败 | 10 分钟内失败率 > 50% | 站内信 + 短信 |
| 余额异常 | 单用户余额 > 100000 | 站内信 |
| 备份失败 | 定时任务未产出备份 | 站内信 |

### 17.6 接口

```
POST /admin/data/export
POST /admin/data/import/upload
POST /admin/data/import/preview
POST /admin/data/import/confirm
POST /admin/data/batch
GET  /admin/search?q&types
GET  /admin/alerts
```

---

## 18. 数据安全（M16）

### 18.1 备份

```prisma
model BackupRecord {
  id          String   @id @default(cuid())
  fileName    String
  sizeBytes   Int
  checksum    String   // sha256
  type        String   // auto | manual
  verified    Boolean  @default(false)   // 恢复验证是否通过
  verifiedAt  DateTime?
  createdAt   DateTime @default(now())
}
```

### 18.2 备份策略

| 项 | 默认 | 可配 |
|---|---|---|
| 频次 | 每日 03:00 | 是 |
| 保留份数 | 7 天 | 是 |
| 存储路径 | `backend/backups/` | 是 |
| 恢复验证 | 每周一次自动演练 | 是 |

### 18.3 备份实现

SQLite 单文件，用 `node:sqlite` 的 `backup` API 或直接文件复制（需先 checkpoint WAL）。

```ts
// 注意：必须在无写入时执行，否则文件可能不一致
await this.prisma.$queryRaw`PRAGMA wal_checkpoint(FULL)`;
copyFileSync(dbPath, backupPath);
const checksum = sha256(readFileSync(backupPath));
```

**备份失败必须告警** —— 静默失败是备份系统最危险的故障模式。

### 18.4 恢复验证

```
恢复验证                              [立即验证]
────────────────────────────────────────────
备份文件    backup-20261019.db
大小        8.2 MB
校验和      3f2a...9c1d        ✓ 完整

验证结果
✓ 文件可打开
✓ 表结构完整（18 张表）
✓ 行数一致（用户 1,240 / 订单 3,456 / 流水 12,890）
✓ 随机抽样数据一致

[下载此备份]
```

**无验证记录的备份视为无效**。这是备份系统的核心原则 —— 一份没验证过能恢复的备份等于没有备份。

### 18.5 数据保留期

| 数据类型 | 保留期 | 依据 |
|---|---|---|
| 订单与交易信息 | ≥ 3 年 | 《电子商务法》 |
| 审计日志 | ≥ 6 个月 | 监管与风控 |
| 生成产出素材 | 1 年 | 用户主动删除或到期 |
| 用户输入素材 | 1 年 | 同上 |
| 应用日志 | 90 天 | 运维排障 |
| 登录日志 | 1 年 | 安全审计 |

### 18.6 到期清理

调度器每日执行：按保留期清理数据，**订单不参与清理**。

**清理必须留痕**：记录清理时间、类型、数量，审计日志不可删原则同样适用于清理记录。

### 18.7 敏感字段脱敏

| 字段 | 展示 |
|---|---|
| `passwordHash` | 永不展示，不提供接口 |
| token | 只显示前 4 后 4 |
| 网关令牌 | 只显示是否配置 + 脱敏值 |
| 身份证号（若有） | 掩码显示 |

**禁止提供任何形式的明文回显接口**。

### 18.8 接口

```
GET  /admin/backups                    # 列表
POST /admin/backups/run                # 手动备份
POST /admin/backups/:id/verify         # 恢复验证
GET  /admin/backups/:id/download
GET  /admin/retention-policies
PUT  /admin/retention-policies
GET  /admin/cleanup-logs
```

### 18.9 边界

| 场景 | 处理 |
|---|---|
| 备份时数据库有写入 | 先 WAL checkpoint；仍不一致则标记备份可疑 |
| 磁盘空间不足 | 备份失败告警，不静默跳过 |
| 恢复演练失败 | 告警 + 标记该备份 invalid |
| 清理误删 | 清理前先归档，保留 30 天后再物理删除 |
| 保留期改短 | 立即生效，不影响已在保留期内的数据 |

---

## 19. 内容安全（M17）

### 19.1 送审策略

```
┌────────────────────────────────────────────┐
│ 送审策略                                   │
├────────────────────────────────────────────┤
│ 上传侧    [✓ 开启]   命中处理 [阻断上传 ▾]  │
│ 输出侧    [✓ 开启]   命中处理 [阻断发放 ▾]  │
│                                            │
│ 服务商    [内容安全服务 A ▾]               │
│ 超时      3000 ms                          │
│ 失败策略  [放行 ▾]  ← 送审服务故障时的兜底  │
└────────────────────────────────────────────┘
```

**失败策略说明**：送审服务故障时若选择「阻断」，会导致用户无法生成 —— 需权衡。选择「放行」则存在违规内容漏检风险，界面须明示这一取舍。

### 19.2 判定结果处置

| 判定 | 可选动作 |
|---|---|
| 通过 | 放行 |
| 疑似 | 阻断发放 / 人工复核 |
| 违规 | 阻断 + 下架产出 + 记 `ComplianceLog` |

### 19.3 处置台账

```prisma
model ContentReview {
  id         String   @id @default(cuid())
  assetId    String
  stage      String   // upload | output
  decision   String   // pass | suspect | violate
  labels     String   // JSON：命中的标签
  score      Float?
  handled    Boolean  @default(false)
  action     String?  // block | takedown | freeze_user
  handledBy  String?
  handledAt  DateTime?
  rawResult  String   // 服务商原始响应，供举证
  createdAt  DateTime @default(now())

  @@index([decision, handled])
}
```

### 19.4 接口

```
GET/PUT  /admin/content/policy
GET      /admin/content/reviews?decision&stage&from&to&page
PATCH    /admin/content/reviews/:id/action   { action, reason }
GET      /admin/content/reviews/export
```

### 19.5 边界

| 场景 | 处理 |
|---|---|
| 送审服务超时 | 按配置的失败策略处理，记录超时事件 |
| 送审服务返回异常格式 | 记录原文，按失败策略处理，不静默放行 |
| 同一素材重复送审 | 按 `(assetId, stage)` 去重 |
| 误判申诉 | 工单中心接收，人工复核后更新 `handled` |
| 处置台账导出 | 供对外提供时使用，导出含服务商原始响应 |

---

## 20. 基础设施

### 20.1 调度器

```
backend/src/common/scheduler/
├── scheduler.module.ts
└── jobs/
    ├── close-expired-orders.job.ts    # 每分钟
    ├── expire-credit-lots.job.ts     # 每日 00:10
    ├── restore-free-pricing.job.ts    # 每日 00:20
    ├── cleanup-expired-data.job.ts   # 每日 03:30
    ├── backup-db.job.ts              # 每日 03:00
    └── verify-backup.job.ts          # 每周一 04:00
```

选用 `@nestjs/schedule`。**注意**：本仓 npm 走 broker 代理，大批量安装触发 5 分钟超时，需按 CLAUDE.md 记录的方式直装 registry。

### 20.2 健康检查

```
GET /api/v1/health          # 存活探针：进程存活即 200
GET /api/v1/health/ready    # 就绪探针：检查依赖
```

就绪检查项：数据库可读、存储目录可写、调度器已启动。

**不放后台守卫** —— 健康检查端点必须免鉴权，否则监控无法探测。

### 20.3 结构化日志

```
{ timestamp, level, msg, requestId, userId?, adminId?, module, action?, target?, durationMs?, error? }
```

按 `requestId` 串联一次请求的全部日志；后台操作额外记 `adminId` 与 `action`。

**敏感字段不入日志**：密码、令牌、凭据、个人信息。

### 20.4 错误追踪

异常聚类上报，按堆栈指纹归并。同类错误出现频次超阈值时告警。

### 20.5 端到端测试

必须覆盖的场景：

| 类别 | 用例 |
|---|---|
| 越权 | `operator` 打 `finance` 接口 → 403；C 端 token 打 admin 接口 → 403；无 token → 401 |
| 并发 | 同一用户并发提交 10 个生成任务，积分不超扣 |
| 幂等 | 同一 `idempotencyKey` 重复下单 → 只建一单 |
| 回调幂等 | 同一 `payTransactionId` 重复回调 → 只发一次积分 |
| 状态机 | 已 `fulfilled` 订单再次支付回调 → 不重复发积分 |
| 记账 | 扣费 → 失败 → 退还，余额归零；批量扣减后余额不为负 |

### 20.6 API 文档

Swagger（`@nestjs/swagger`）。仅在非生产环境启用。

---

## 附录 A · 前后端改动清单

| 层 | 文件 | 改动 | 批次 |
|---|---|---|---|
| 后端 | `admin/` | 新增，见 §0.1 | M2 |
| 后端 | `common/scheduler/` | 新增 | M9.5 |
| 后端 | `app.module.ts` | 注册 `AdminModule`、调度器 | M2 |
| 后端 | `common/jwt.service.ts` | 载荷不含 role（权限实时查库） | M2 |
| 后端 | `auth/auth.service.ts` | 登录写 `lastLoginAt` | M2 |
| 后端 | `main.ts` | 移除 `useStaticAssets`，改受控文件接口；加 `trust proxy`、安全响应头 | M2 |
| 后端 | `generate/generate.service.ts` | 建任务前扣费、失败退还 | M6 |
| 后端 | `assets/assets.service.ts` | 用户端列表过滤 `status='visible'` | M5 |
| 后端 | `capabilities/capabilities.controller.ts` | 合并能力开关后下发 | M14 |
| 前端 | `components/admin/` | 新增，见 §0.1 | M2 |
| 前端 | `pages/admin/` | 20 个页面 | M2-M17 |
| 前端 | `lib/api.ts` | 新增 `adminApi` 分组 | M2 |
| 前端 | `types/api.d.ts` | 新增 admin 类型段 | M2 |
| 前端 | `context/AuthContext.tsx` | 存 role | M2 |
| 前端 | `App.tsx` | `/admin/*` 分支（注册在 catch-all 之前） | M2 |
| 前端 | `styles/global.css` | 新增 `adm-*` 样式 | M2 |

## 附录 B · 已知限制

| 限制 | 影响 | 缓解 |
|---|---|---|
| 任务终止无检查点 | `processTask` 会跑完并覆盖产出 | 中期：给 processTask 加 AbortSignal |
| 审计可被数据库直删 | 管理员可绕过 | 已知不足，独立存储本期不做 |
| 审计 IP 依赖 `trust proxy` | 未配置时拿到的是代理 IP | 部署时必须配置 |
| 积分余额实时聚合 | 批次极多时查询变慢 | 用户维度数据量可控；必要时加缓存 |
| SQLite 单机 | 并发写入瓶颈、数据丢失风险 | 备份机制缓解；长期需迁 PostgreSQL |
| 送审服务为外部依赖 | 未选型前内容安全能力不可用 | 界面明示未接入 |
