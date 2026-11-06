# 后台管理端 · 详细设计

后台各模块的页面结构、接口、数据流与边界处理。本文只写**怎么做**，不重复**做什么**（功能与定位见 `docs/admin-console-design.md`，信息架构与 RBAC 见 `docs/admin-suite-design.md`，视觉规格见 `docs/admin-ui-design.md`）。

| 项 | 事实源 |
| --- | --- |
| 后端模块注册与守卫顺序 | `backend/src/admin/admin.module.ts` |
| 权限点与内置角色 | `backend/src/admin/permissions.ts` |
| 菜单分组 | `frontend/src/components/admin/adminNav.ts` |
| 通用组件与列表 hook | `frontend/src/admin-ui/primitives/index.ts`（控件 + hook 统一出口） |
| 请求层 | `frontend/src/lib/api.ts` 的 `adminApi` |

---

## 0. 通用设计

### 0.1 目录结构

```
backend/src/admin/
├── admin.module.ts                  # 模块装配（守卫/拦截器在此注册）
├── admin.guard.ts                   # 后台身份 + 账号状态（每次查库）
├── permission.guard.ts              # 权限点校验
├── admin.decorator.ts               # @RequirePermission / @AuditAction
├── audit.interceptor.ts             # 写操作自动审计
├── permissions.ts                   # 权限点单一事实源
├── admin-role.service.ts            # 角色读取、权限过滤、hasPermission
├── admin.controller.ts              # /admin/me /overview /permissions
├── overview.service.ts              # 平台概览聚合
├── users.controller.ts / users.service.ts
├── assets-admin.controller.ts / assets-admin.service.ts   # 项目与素材
├── tasks-admin.controller.ts / tasks-admin.service.ts
├── tickets-admin.controller.ts
├── legal.controller.ts / notifications.controller.ts
├── commerce.controller.ts / commerce-admin.service.ts     # 商品/订单/支付/积分
├── marketing.controller.ts
├── invoices-admin.controller.ts
├── payments/payment-admin.controller.ts             # 支付域：渠道/商品/订单/对账
├── capability.controller.ts
├── roles.controller.ts / settings.service.ts / ../common/setting-defs.ts
├── storage.controller.ts / scheduler.controller.ts / scheduler.service.ts
├── backup.controller.ts / backup.service.ts / retention.controller.ts
├── audit.controller.ts / audit.service.ts
└── search.controller.ts / search.service.ts
```

模型层的后台接口不在这里：渠道 / 前台模型 / 用户分组 / 插件 / 账单 / 分析 / 调用记录分别由 `backend/src/model/**` 下的 controller 提供（`channel.controller.ts`、`admin-logical-model.controller.ts`、`user-group.controller.ts`、`plugin.controller.ts`、`billing-admin.controller.ts`、`analytics.controller.ts`），路由与权限见 `docs/model-architecture.md` 的「后台页面 / 接口」表。

```text
frontend/src/admin-ui/              # 后台 UI（shadcn · radix 底座）
├── components/ui/                  # shadcn 原子件（只被 primitives 引用）
├── shell/AdminBoardLayout.tsx      # 外壳（shadcn Sidebar：全高侧栏 + 内容区顶栏）
├── primitives/                     # 页面唯一取用层：layout / form / display / fields / table / overlay / drawer / batch-result / duty-* / chart
├── providers/                      # Toast / Confirm / AdminUIProvider
├── hooks/useAdminList.ts           # useAdminList / useAdminResource / useAdminUrlFilterSync / useAdminDetailParam
└── lib/                            # cn（官方 cn 包 + 补登表）、density（DensityContext）、format（时间 / 金额 / 字节）

frontend/src/components/admin/
├── adminNav.ts                     # ADMIN_MENU 单一事实源
├── AlertCenter.tsx                 # 告警来源聚合（告警中心页）
├── DutyContext.tsx                 # 概览首屏值班塔的数据轮询
└── statusMeta.ts                   # 状态 → 文案 / 色调映射

frontend/src/pages/admin/            # 34 个页面 + channels/、payments/ 子目录
```

### 0.2 守卫链与审计

```ts
// admin.module.ts
providers: [
  { provide: APP_GUARD, useClass: AdminGuard },
  { provide: APP_GUARD, useClass: PermissionGuard },
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
]
```

| 环节 | 职责 | 拒绝响应 |
| --- | --- | --- |
| `AdminGuard` | 解 Bearer token 后**查库**取 `role` / `status` | 401 `40101`；`disabled` / `deleted` → 403 `40302`；非后台角色 → 403 `40301` |
| `PermissionGuard` | 读 `@RequirePermission` 元数据，比对 `AdminRole.permissions` | 403 `40301`（不回显所需权限名；端点漏声明权限点时**拒绝**而非放行） |
| `AuditInterceptor` | 写操作自动审计；显式声明 `@AuditAction` 的 GET 导出 / 下载也审计 | 不阻断业务，写失败只 WARN |

执行顺序：`AdminGuard` → `PermissionGuard` → controller → `AuditInterceptor`。三者内部对非 `/admin` 路径直接放行，C 端链路不受影响。

**为什么每次查库**：token TTL 7 天，若只信 token 内的角色，降权或禁用后旧 token 仍可用 7 天。SQLite 单文件、admin 接口低频，开销可忽略。

**审计口径**：

- 写操作一律记录；GET 导出 / 下载只有显式声明 `@AuditAction` 时才记录。
- `detail` 只取白名单字段（`status` / `role` / `name` / `priceCents` 等），命中 `password|token|secret|hash|credential` 的字段一律不写。
- 普通管理写操作由 `AuditInterceptor` 按动作与结果自动生成稳定原因并落 `AdminAuditLog.reason`；只有退款、发票驳回、能力下架等真实业务语义需要由调用方提供原因。审计原因不作为页面确认门槛。
- 审计失败**不阻断业务**：让它阻断等于把审计变成单点故障，反而降低可追溯性。

### 0.3 权限点命名

`<模块>.<动作>`，66 个，完整清单见 `permissions.ts` 的 `PERMISSIONS`（分组表见 `docs/admin-suite-design.md` §2.2）。三条约束：

1. 权限点从清单移除后，角色里残留的值比对不上即等同无权（兜底默认拒），`AdminRoleService.getPermissions()` 读取时过滤；过滤只在内存生效，不回写库。
2. 三个内置角色不可删除，但权限点均可调整（含 `admin`）：批量更新会校验未知权限点与角色是否存在，不阻止裁剪；整批写入在同一事务中完成，改动因守卫每次请求查库而立即生效。
3. 前端 `AdminContext.can()` 只隐藏按钮，**不是安全边界**。

### 0.4 列表页通用模式

`admin-ui/hooks/useAdminList.ts` 的 `useAdminList` 统一处理分页、筛选、刷新与失败态（随 `admin-ui/primitives` 导出）：

```ts
const { data, total, loading, error, reload, setPage, setFilters } = useAdminList(fetcher, {
  pageSize: 20,
});
```

| 组件 | 用途 |
| --- | --- |
| `adminPagination({ total, page, pageSize, onChange })` | 标准分页配置 |
| `adminMiniPagination(...)` | 小表格 / 抽屉内分页 |
| `AdminListLoading` / `AdminListError` / `AdminStaleError` | 三种加载态；`StaleError` 用于「有旧数据但本次刷新失败」 |
| `useAdminResource(fetcher, deps)` | 非列表型单次拉取（表单初值、统计卡） |

页面结构统一：`PageHeader`（标题 + 主操作）→ 筛选条 → 表格 → 分页。表格一律 `rowKey="id"`、`size="small"`。

### 0.5 详情抽屉

`AdminDrawer` 统一宽度、标题、底部操作区与关闭行为。详情不跳独立路由——保留列表筛选态比省一层路由更重要。

### 0.6 高危操作确认

`ConfirmDialog`（shadcn `AlertDialog` 组合壳，`admin-ui/primitives/overlay`）用于删除、退款、重置密码、手动调整积分、渠道 / 前台模型写入、角色与系统设置写入、备份。文案必须写明**影响量**（`impact` 数组，如「将删除 12 个素材」），不能只写「确定删除吗」。业务原因输入只用于确有业务依据要求的动作（如退款、发票驳回、能力下架）；普通管理写操作不要求填写审计原因。审计始终在操作后由系统自动留痕，不反向要求用户确认审计。2026-10-30 起不再要求输入确认词（`requireTyping` / `typingText` 仅保留入参兼容）。

### 0.7 批量动作

`common/batch.ts` 的 `runBatch(ids, handler)`：

- `ids` 去重，上限 100；
- **串行**执行，**不包事务**——一条失败不该回滚另外 99 条；
- 逐条返回 `{ id, ok, message?, data? }`；
- 前端批量动作完成后用 toast 汇报成功 / 失败条数，不再弹逐条结果框。

路由挂较弱读权限，处理器内再用 `AdminRoleService.hasPermission()` 判动作权限（`40301`）。

### 0.8 CSV

`common/csv.ts`：UTF-8 **BOM** + RFC4180 引号转义 + 公式注入前导 `'`（`=` `+` `-` `@` 开头）。前端 `downloadCsv()` 独立于 `request()`，CSV 不走 JSON 信封。导入按行返回结果，避免一行错整批失败。

### 0.9 前端权限

`AdminContext` 从 `GET /admin/permissions` 取当前角色的权限点集合，暴露 `can(permission)`。仅用于隐藏无权限的按钮与菜单项。

---

## 1. 平台概览 `/admin`

### 1.1 页面结构

顶部指标卡（用户 / 任务 / 素材 / 交易）+ 趋势折线 + 交易概览 + 最近任务列表。

### 1.2 接口

`GET /admin/overview?days=7`（`platform.dashboard`）。一段响应里给三段数据：

| 段 | 字段 |
| --- | --- |
| `totals` | `users` / `newUsers` / `projects` / `tasks` / `succeeded` / `failed` / `running` / `pending` / `successRate` / `assets` / `originals` / `generated` |
| `trend` | 按日任务序列，长度由 `days` 决定 |
| `window` | 窗口口径任务量 / 成功率 / 失败原因 Top 6 / 窗口营收与新增用户 |
| `comparison` | 上一等长窗口的同口径数字，用于环比 |
| `commerce` | `orders` / `gmvCents` / `gmvWindowCents` / `pendingCents` / `refundedCents` / `refundedWindowCents` / `paymentSuccessRate` / `members` / `credits` / `channelMix` / `revenueTrend` |

### 1.3 口径

- 金额一律整数分，后端不做展示层格式化，避免「接口返回元、页面再乘 100」的口径漂移。
- `paymentSuccessRate` 无支付流水时返回 `null` 而非 `0`：`0%` 会被误读为「支付全挂了」。
- 任务状态分布是全量，不受 `days` 窗口影响；趋势、「新增」、`window` 与 `comparison` 受窗口影响。
- 环比用紧邻的等长窗口，不用累计做分母；上一窗口为 0 时前端显示「新增」或「—」，不显示 ∞%。
- 只统计现有表，不出现无数据支撑的指标。
- **30 秒内存缓存**：`overview` 按 `days` 缓存 30 秒，响应带 `generatedAt`，页面明确展示「数据截至」；切换窗口或点刷新不会击穿到全量重算。

---

## 2. 用户管理 `/admin/users`

### 2.1 接口

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/admin/users?keyword&role&status&page&pageSize&sort` | `user.read` |
| GET | `/admin/users/:id` | `user.read` |
| GET | `/admin/users/:id/logins` | `audit.read` |
| GET | `/admin/users/:id/impact` | `user.read` |
| PATCH | `/admin/users/:id/status` | `user.disable` |
| PATCH | `/admin/users/:id/role` | `user.write` |
| POST | `/admin/users/:id/password` | `user.reset_password` |
| DELETE | `/admin/users/:id` | `user.delete` |
| GET | `/admin/users/export` | `user.read + data.export` |
| POST | `/admin/users/batch` | 对应用户动作权限 |
| GET | `/admin/users/meta/roles` | `user.read` |

### 2.2 规则

- **禁用立即生效**：`AdminGuard` 与 `JwtAuthGuard` 每次请求查库校验 `status`，不走 token 内快照。
- **角色变更**：`user` / `admin` / `operator` / `finance` 四个值（`USER_ROLES`）；最后一个 `admin` 不可降级，服务层断言后返回 409。
- **重置密码**：生成一次性强密码，只在本次响应里出现一次，不落库、不进审计 detail。
- **删除**：走 `account-lifecycle.service.ts`，与 C 端自助注销同一份实现。清除作品 / 素材 / 项目 / 积分批次与对象存储文件，终止生效中的会员；保留订单 / 支付 / 退款 / 发票 / 积分流水（流水断开批次引用），账号匿名化并置 `deleted`。删除前用 `impact` 预览将清除与保留的量。

---

## 3. 项目与素材 `/admin/assets`

### 3.1 接口

`projects`（列表 / 删除）、`assets/stats`、`assets`（列表）、`assets/:id/impact`、`assets/:id/status`、`assets/batch-status`、`assets/batch`、`assets/export`、`assets/:id`（删除）。

### 3.2 规则

- 素材按 `kind`（`original` / `generated`）、能力、用户、时间筛选；列表要同时支持缩略图网格与表格视图。
- **下架**置 `Asset.status='hidden'`，C 端列表过滤。这是后台唯一会改变 C 端可见性的动作。
- **删除**连带磁盘文件与对象存储对象；生成图删除时连带删除产出它的任务。
- 图片地址走 `displayUrl()` / 签名 URL 服务，不暴露磁盘路径。

---

## 4. 任务监控 `/admin/tasks`

### 4.1 接口

`GET /admin/tasks`、`/admin/tasks/stats`、`/admin/tasks/capabilities`、`/admin/tasks/export`、`/admin/tasks/:id`、`POST /admin/tasks/:id/retry`、`POST /admin/tasks/:id/cancel`、`POST /admin/tasks/batch`。

### 4.2 规则

- **全链路详情**：抽屉按同一 `taskId` 集中展示用户提交、参数 / 输入素材、线路尝试、模型调用、产出和账单终态。`GET /admin/tasks/:id`（`task.read`）返回任务及按 `routeRun / attemptNumber` 排序的 `routeAttempts`；最近 20 次模型调用走 `/admin/api-logs?taskId=`（`model.call_read`），并深链 `/admin/model-calls?taskId=` 查看全部；账单走 `/admin/billing-orders?taskId=`（`billing_order.read`），并深链 `/admin/billing-orders?taskId=`。无对应权限时不请求，只显示权限边界。
- **排障语义**：`dispatchState` 回答请求是否可能到达上游，账单终态回答钱是否已处理。建连前网络失败可安全切线；全部线路都未接单时任务以 `42204` 失败并自动退款。`refunded + system:preconnection-reconcile` 明确显示“无需人工复核”；只有 `reviewable=true` 才进入待核对队列。`submission_unknown` 且账单仍为 `reviewable` 时才需人工确认，不能把网络拒绝误判为上游已接单。
- **重试不复用旧记录**：用原参数与原输入新建任务，再复用 `GenerateService.enqueue` 触发执行。原地复活会绕过 `GenerationTask.outputAssetId @unique` 的一产出约束。
- **终止**把 `running` 置 `failed` + `cancelled_by_admin`，按任务快照退款。
- 统计条显示各状态计数，积压（`pending` / `running`）超阈值标红。
- **导出** CSV 与列表共用 `listWhere`，筛什么导什么，上限 5000 行，需 `task.read + data.export` 并留审计。
- **性能**：能力筛选项的全表 `groupBy` 缓存 60 秒；拥堵指标仍实时查询。`GenerationTask` 增加 `[status, createdAt]` 与 `[ownerId, createdAt]` 组合索引，服务「状态 + 时间窗」和用户详情时间线。
- 告警链接 `?status=failed|running` 会作为列表初始筛选；页面已打开时 URL 变化也会同步过去。

---

## 5. 工单处理 `/admin/tickets`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/tickets?status&assigneeId&keyword&page` | 列表 |
| GET | `/admin/tickets/stats` | 各状态计数 |
| GET | `/admin/tickets/:id` | 详情含回复流 |
| POST | `/admin/tickets/:id/replies` | 回复；客服首次回复即 `open → processing` 并自动认领 |
| PATCH | `/admin/tickets/:id` | 改状态或指派 |
| GET | `/admin/tickets/export` | CSV 导出 |

状态机只在 `tickets.service.ts` 的 `TRANSITIONS` 定义（`open → processing → resolved/closed`、`resolved → closed/open`、`closed → open`），跳步返回 400。指派只能给启用中的后台账号，`assigneeId: null` 表示取消指派。越权访问一律 404 而非 403，不泄露 id 是否存在。

**退款的边界**：工单只做沟通与流转，退款到订单模块执行，避免两处都能改钱。

---

## 6. 法务文档 `/admin/legal`

`GET /admin/legal`（版本列表）、`PUT /admin/legal`（新建草稿）、`POST /admin/legal/:slug/:version/publish`（发布）。

- 四类固定 slug（`LEGAL_SLUGS`）：`user-agreement` / `privacy-policy` / `minors-policy` / `account-rules`。
- 按 `(slug, version)` 版本化；已发布版本**不可原地覆盖**（`upsert` 返回 409），改文本须升版本号。
- 发布时同 slug 的其他已发布版本自动 `archived`，保证 `current()` 唯一。
- 前台 `GET /legal/:slug` 只读最新已发布版本，读不到时 `LegalPage` 用内置文本兜底。
- 读 `legal.read`、写 `legal.write`；发布自动写审计，不要求填写变更原因。

---

## 7. 站内消息 `/admin/notifications`

`GET /admin/notifications/channels`（实际生效的邮件 / 短信实现：`provider` / `delivers` / `configured`，不含凭据）、`POST /admin/notifications/broadcast`（全站广播）、`GET|POST /admin/notifications/templates`。

- 模板只替换 `{name}` 形式占位符，缺失时回落代码内置文案。
- `notify()` 永不抛异常：写库失败只 WARN，业务事件不能因为通知失败而回滚。
- 已接业务事件：支付成功、任务失败退款（**仅退款真的成功时**）、会员到期、工单回复。
- 权限 `message.write`。

---

## 8. AI 标识 `/admin/aigc-label`

`GET|PUT /admin/aigc-label`（`setting.read` / `setting.write`）。

### 8.1 数据

`AigcLabelConfig` 单行（`id='default'`）：`specJson` 样式 + `pngBase64` 位图 + `specKey` 过期判定。默认值在 `common/aigc-label.config.ts` 的 `AIGC_LABEL_DEFAULTS`，运行期 3s 缓存，保存即 `invalidate()`；读失败回退默认值不抛错（配置坏了也要能打标识）。

### 8.2 渲染分工

服务端不栅格化中文：Jimp 内置字体只有 ASCII。保存时由浏览器 Canvas 以 2x 渲染 PNG，与 `specJson` 原子提交；服务端只做缩放、定位、透明度合成。内置默认位图由 `scripts/gen-aigc-label.mjs` 生成，改内置文案或配色必须重跑。

`specKey` 只哈希渲染相关字段（`enabled` 不入哈希，不影响位图）。样式改了但位图未重存会被标 `stale`：仍用旧位图，页面提示重存。

### 8.3 与生成链路的接口

- 顺序：先合成角标，再写元数据。反序会打乱偏移损坏图片。
- 显式标识失败 → 任务 `failed/42203` 并退款；元数据写入失败 → 告警但仍落库。
- 关闭可见角标时隐式标识照常写入；若隐式标识也无写入路径（webp / gif），仍按失败退款。

---

## 9. 商品与消耗价

`/admin/products`（`product.read` / `product.write` / `product.publish`）与 `/admin/credit-prices`（`product.price`）。

- 商品 SKU 存 `Product`，价格与积分以快照字段落到 `OrderItem`（`priceCentsSnapshot` / `creditsSnapshot`）。
- **能力消耗价**读写走 `CreditPriceService`，返回生效价与来源（`default` / `override` / `campaign`）。业务代码不读 `creditCost`，否则后台调价不生效。
- 限时免活动命中的能力 `resolve()` 直接返回 0，优先于后台覆盖价；页面显示 `source: 'campaign'`，运营据此判断「改了价没生效」是活动在起作用。
- 上下架用 `product.publish` 单列权限：能改价不等于能发布。

---

## 10. 订单管理 `/admin/orders`

### 10.1 状态机

```ts
pending → paid | cancelled
paid → refunded | partial_refunded
partial_refunded → refunded | partial_refunded
```

未支付订单 30 分钟自动关闭（`ORDER_TTL_MINUTES`），由调度任务执行。已支付订单只能走退款，不能取消。

### 10.2 后台动作

| 动作 | 说明 | 权限 |
| --- | --- | --- |
| 标记已支付 | `channel='manual'`，用于线下收款核销；不调渠道 | `order.mark_paid` |
| 退款 | 先校验 → 落 `Refund(processing)` → 调渠道 → 成功后才回收积分与迁移状态 | `order.refund` |
| 批量 / 导出 | `orders/batch` / `orders/export` | 对应订单动作权限 / `order.read + data.export` |

列表支持按退款状态筛选（`?refundState=processing|failed|succeeded`）。退款状态挂在 `Refund` 行上，一笔订单可能多次部分退款；告警中心正是用它把「渠道已受理但本地未落账」的订单捞出来。

### 10.3 退款顺序不可反

1. 硬约束校验：金额 ≤ 实付 − 已退（`40001`）。
2. 可配规则：时间窗 `40905`、比例 `40906`、本次退款应回收份额已消耗且扣不回 `40907`。积分只从本订单批次回收，不跨订单挪用；部分退款按累计退款比例的本次份额校验。
3. 已有 `processing` 退款 → `40908`。
4. 落 `Refund(status='processing')`，用它的 id 作渠道幂等键 `outRefundNo`。
5. 调渠道：失败置 `failed` 并抛 `50302`，**订单状态与积分不变**。渠道结果未知时复用原退款号重试；人工核销为失败后必须新建退款单。成功才回收积分、迁移订单状态、累加 `refundedCents`。

会员单全额退款只撤销该订单对应的周期并重算当前会员；仍有其他已付周期时不会整体终止，只有最后一期被撤才返回 `membershipTerminated=true`。退款成功响应还带 `invoiceFollowUp`：仅当待开票票面超过剩余可开票金额时要求驳回，仍可覆盖时不产生告警；已开票需线下冲红并登记。渠道异步处理中返回 `invoiceFollowUp: null`。**绝不允许「只改库、假装退过钱」**。

---

## 11. 支付与财务

### 11.1 支付充值 `/admin/payments`

四标签共用一个页面（`frontend/src/pages/admin/payments/`）：**支付渠道 / 充值商品 / 支付订单 / 支付对账**。URL 的 `?tab=` 是标签的事实源，非法值回落到「支付渠道」；旧路由 `/admin/payment-channels` 与 `/admin/reconciliation` 改为重定向。

| 标签 | 接口 | 规则 |
| --- | --- | --- |
| 支付渠道 | `GET /admin/payments/providers`、`PUT /admin/payments/providers/:id/config` | 每个适配器一份**版本化 + 加密**配置（`PaymentProviderConfig`），追加写不覆盖。密钥字段只回「是否已配置」，留空表示沿用旧值；身份类字段（商户号等）锁定不可改。保存写审计，不要求填写原因 |
| 充值商品 | `GET/POST/PUT /admin/payments/products*` | 复用 `Order` / `Product`，**不新建** `TopupProduct` 表；售价按分存、周期 / 库存 / 限时策略随类型切换 |
| 支付订单 | `GET /admin/payments/orders*` | 列表服务端分页（默认 30）；查单与关单使用 `payment.operate`，属于非高危写操作，自动写审计但不要求填写变更原因。关单前始终先向渠道查单；已入账订单关单返回 `409` |
| 支付对账 | `GET/POST /admin/payments/reconciliations*` | T+1 自动对账（每天 10:15 跑昨日账单）；差异分八类（含同一商户单多交易号的 `duplicate_charge`），已支付未入账经签名查单二次确认后**自动补发积分**（幂等） |

**本页不提供退款**：退款在订单管理，涉及积分与优惠券回滚，放在支付域会让人以为「关单 = 退款」。

对账运行状态只有 `running` / `completed` / `failed`；旧的 `imported` / `resolved` 语义已随新模型下线（人工处置走订单退款流程，不在页面上改钱）。

### 11.2 发票

`/admin/invoices`（`invoice.write`）。同一订单保留历史但最多一张有效票（`activeOrderId @unique`），金额取申请时 `paidCents - refundedCents` 快照；输出可打印 HTML（零 PDF 依赖）。开具自动写审计；驳回要求填写原因，原因会回显给用户并写入审计。存在 `processing` 退款时禁止开具；开具事务内重新校验订单状态和剩余可开票余额，退款后票面超余额必须驳回重提。`GET /admin/invoices/export` 导出同一 `status` / `keyword` 口径的 CSV（金额同时给分与元，`invoice.write + data.export` + 审计）。

---

## 12. 积分账本 `/admin/credits`

`GET /admin/credits/...`（余额总览、批次、流水）、`POST /admin/credits/adjust`（`credit.adjust`）、`POST /admin/credits/import`（`credit.adjust`）、`GET /admin/credits/export`（`credit.read + data.export`）。

- 余额 = `CreditLot` 未用完且未过期的批次之和。
- 消耗按 **FEFO**（先到期先扣，`NULL` 视为最晚到期）跨批次扣减；余额不足整体回滚并报 `40002`（前端按 402 语义处理）。
- 流水类型：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`。人工增减落 `admin_adjust` 并自动写审计，不要求填写审计原因。
- CSV 导入按**邮箱**匹配用户，逐行返回结果（匹配不到、格式错误都单独报，不整批回滚）。

---

## 13. 营销

| 页面 | 接口 | 规则 |
| --- | --- | --- |
| 优惠券 | `/admin/coupons*`（`marketing.write`） | 满减 / 折扣 / 固定额；发放范围、门槛、有效期、每人限用、总量；限量名额由 pending 订单预占、支付时核销、取消/超时释放，核销走 `Order.couponId`；`GET /admin/coupons/export` 按同一筛选导出 CSV（`marketing.write + data.export` + 审计，路由在 `:id` 之前） |
| 限时活动 | `/admin/campaigns*` | 类型 `limited_price` / `limited_free` / `popup`；进行中的免活动让 `resolve()` 返回 0；到期由调度任务收尾；`GET /admin/campaigns/export` 按同一筛选导出 CSV（`marketing.write + data.export` + 审计） |
| 邀请与签到 | `/admin/invites*`、`/admin/checkin*` | 邀请奖励在被邀请人**首次付费**才触发；签到规则含基础积分与连签加成 |

C 端读取接口在 `marketing.controller.ts`（公开的 `/marketing/campaigns` 只回真正更便宜且在售的活动）。

---

## 14. 系统设置 `/admin/settings`

`GET|PATCH /admin/settings`（`setting.read` / `setting.write`）。默认值与键名只在 `backend/src/common/setting-defs.ts` 的 `SETTING_DEFS` 定义，包括：站点信息、上传限制、生成超时与轮询、退款规则（`refund.windowDays` / `refund.maxRatioBps` / `refund.allowConsumedTask`）、备份频次与保留份数。

规则：

- 写入载荷为 `{ settings: Record<key, value>, clears?: string[] }`；`settings` 用点号键，`clears` 删除运行时覆盖并回落代码默认值。
- 写入前按 `SETTING_DEFS` 做类型与范围校验，非法值整体拒绝；同一键不能同时出现在 `settings` 与 `clears`。
- 只读项（`readOnly`）不渲染可编辑控件，只展示当前值并给出 `linkTo` 入口。
- 退款规则的读取方是 `order.service.refund`，规则对象由后台控制器取好后传入，订单域不依赖 admin 层。
- 保存自动写审计；`setting.write` 属高危，不要求填写变更原因。

### 14.1 角色权限 `/admin/roles`

`GET /admin/roles`（`role.read`）返回三个内置角色的**库内实际权限点**（不是代码默认值，否则页面显示与实际不符）；`PATCH /admin/roles`（`role.write`，高危，`AuditAction('role.permissions_update')`）批量保存本次页面改动。

规则：

- 角色不可增删改名，`builtIn` 恒为 `true`；三个角色的权限点都能改，包括 `admin`。
- 请求体为 `{ roles: [{ code, permissions }] }`；写操作自动记录审计原因。
- 未知权限点整体拒绝（400 `40001`），不静默丢弃 —— 否则调用方会以为保存成功。
- 多角色改动在一个事务中写入，避免部分角色已生效、部分失败的半保存状态；审计记录每个角色新增 / 移除的权限点。
- 改动立即生效：`AdminGuard` / `PermissionGuard` 每次请求查库，不需要重启或重新登录。操作者把自己权限改没了也会当场生效（可由其他 admin 恢复）。
- 前端 `AdminRolesPage` 用 `can('role.write')` 控制可编辑态，按 66 个权限点分组勾选，高危权限点单独标注。

---

## 15. 存储配置 `/admin/storage`

`GET /admin/storage/status`（当前后端、容量、连通性）、`POST /admin/storage/probe`（探测）、`POST /admin/storage/active?backend=`（切换）。

- 后端：`local`（默认）/ `oss` / `minio`，由 `STORAGE_BACKEND` 决定初始值。
- 切换**只影响新上传**：`Asset.storageBackend` 记录写入时的后端，老素材仍从原后端读。
- 后端未就绪（SDK 未安装或凭据缺失）时，上传直接失败并给出明确文案，不静默写本地盘。
- 云端 SDK 是可选依赖，切之前必须先装包。

---

## 16. 定时任务 `/admin/scheduler`

`GET /admin/scheduler/status`、`POST /admin/scheduler/run?name=`（`setting.write`）。

| 任务 | 作用 |
| --- | --- |
| `order-expire` | 未支付订单超时关闭 |
| `credit-expire` | 积分批次到期回收 |
| `membership` | 会员到期失效与月度积分发放 |
| `backup` | 定时备份 |
| `cleanup` | 保留期清理 |
| `campaign-expire` | 活动到期收尾 |
| `task-recover` | 中断任务回收与会员补发 |

- 单轮检查里**每个任务独立 try/catch**：一个任务抛错不该连累其它任务（早期用一个大 try 包住全部，备份失败会连带跳过订单超时关闭）。
- 有重入保护：上一轮未结束不重复触发。
- 执行状态（上次时间、耗时、是否成功、连续失败次数）放内存，不落库——运行时指标与需要长期留痕的任务审计是两件事。
- 手动触发只允许幂等任务。

---

## 17. 操作审计 `/admin/audit-logs`

`GET /admin/audit-logs`、`/admin/audit-logs/:id`（`audit.read`）。按操作人 / 动作 / 时间筛选，详情含原因、IP、请求 ID。**只读，无删除接口**。

`GET /admin/audit-logs/export`（`audit.read + data.export` + 审计）导出同一筛选口径的 CSV，详情列为 JSON；上限 5000 行。路由必须声明在 `:id` 之前。

导出与备份下载是 GET，但显式声明了 `@AuditAction`，`AuditInterceptor` 同样落审计 —— 把数据带出系统必须能回答「谁、何时、导了哪类数据」。

---

## 18. 模型层后台

模型组共 8 页，按「供应侧 → 产品侧 → 运营侧」排列：`/admin/channels` · `/admin/logical-models` · `/admin/user-groups` · `/admin/plugins` · `/admin/model-calls` · `/admin/billing-orders` · `/admin/finance`，外加 `/admin/capabilities`（见第 19 节）。接口实现全部在 `backend/src/model/**`，`src/admin/` 只保留能力管控与通用后台。

### 18.1 渠道工作台 `/admin/channels`

供应侧配置：渠道（凭证加密存储）+ 渠道模型（模态 / 协议 / 权重 / 优先级 / 价格档）。

| 能力 | 接口（前缀 `/admin/channels`） | 权限点 |
| --- | --- | --- |
| 渠道列表 / 详情 / 创建 / 更新 / 删除 / 复制 | `GET /`、`GET /:id`、`POST /`、`PATCH /:id`、`DELETE /:id`、`POST /:id/duplicate` | `channel.read` / `channel.write` |
| 排序、整包导出 / 导入 | `PUT /order`、`POST /export`、`POST /import` | `channel.write` |
| 线路健康 | `GET /health` | `channel.read` |
| 协议下拉 | `GET /protocols` | `channel.model_read` |
| 渠道模型 CRUD / 排序 / 启停 / 批量删除 | `GET|POST /:id/models*`、`PATCH /:id/models/:modelId*`、`DELETE /:id/models/:modelId`、`POST /:id/models/batch-delete` | `channel.model_read` / `channel.model_write` |
| 上游模型目录读取与导入 | `POST /:id/models/fetch`、`POST /:id/models/import` | `channel.model_read` / `channel.model_write` |
| 连通性测试（可测未保存草稿） | `POST /:id/models/test` | `channel.model_write` |
| 跨渠道只读视图 | `GET /admin/channel-models` | `channel.model_read` |

规则：

- `ChannelModel.protocol` 存**插件声明的 provider id**（如 `openai-image`），不是插件 id（`openai-images`）；下拉读协议注册表，手写库或导入时才可能写错，表现为派发报 `channel_unavailable`。
- 凭证只以密文落库（`MODEL_SECRET_KEY` 派生密钥）；读取接口只回显掩码。上游模型目录与连通性测试都在服务端使用已保存凭证发请求，密钥不进浏览器、不落审计。
- 连通性测试走与正式任务相同的协议、出站策略与鉴权，差异只有「不建任务、不扣费」；结果写 `ApiCallLog`（`billable=false`），后台「调用记录」页可查。
- 写入后主动失效目录快照（`CatalogVersionService`），不等 TTL 自然过期。
- `channel.write` / `channel.model_write` 覆盖渠道凭证与价格档：后端没有「只改线路不改价」的独立权限点，前端也不宣称有。

### 18.2 前台模型 `/admin/logical-models`

C 端可见身份（`LogicalModel`）+ 发布快照（`LogicalModelRevision`）+ 线路（`LogicalModelRoute`）。

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/logical-models`、`/:id`（`includeArchived` 可选） | `logical_model.read` |
| 创建 / 更新 / 归档 | `POST /admin/logical-models`、`PATCH /:id`、`DELETE /:id` | `logical_model.write` |
| 选路模拟 | `POST /admin/logical-models/:id/simulate` | `logical_model.read` |

规则：

- 保存即发布一条 revision；任务建单时快照该 revision 的线路与价格，事后改配置不会改已建任务。
- 图像能力的遮罩支持声明在 `capabilityConfig.maskSupported`，下发为 `inputs.mask`；未声明的模型收到遮罩请求返回 `42205`。
- `simulate` 用系统分组身份跑一遍真实选路，返回命中线路与原因，不建任务、不扣费。

### 18.3 用户分组 `/admin/user-groups`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/user-groups`、`/:id` | `user_group.read` |
| 创建 / 更新 / 删除 | `POST /admin/user-groups`、`PATCH /:id`、`DELETE /:id` | `user_group.write` |

- 分组决定倍率（`ratioBasisPoints`）、货币兑换、可见渠道与按模型的覆盖价格。
- 本仓没有 `users.user_group` 列：分组由会员套餐的 `userGroupCode` 映射，没有有效会员的用户落在 `default`，默认分组不可删除。
- 写入必须同时失效分组缓存与目录快照，否则出现「展示按新倍率、扣费按旧倍率」。

### 18.4 插件 `/admin/plugins`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 列表 / 详情 | `GET /admin/plugins`、`/:id` | `plugin.read` |
| 启停 | `PATCH /admin/plugins/:id` | `plugin.write` |
| 校验 / 安装 / 卸载 | `POST /admin/plugins/:id/verify`、`POST /admin/plugins/install`、`DELETE /admin/plugins/:id` | `plugin.write` |
| 服务商目录 | `GET /admin/provider-catalog`、`POST /refresh`、`POST /:id/verify`、`POST /:id/install`（`provider-catalog.controller.ts`） | `plugin.read` / `plugin.write` |

- 插件是协议来源：启停即重建协议注册表，渠道模型可选的协议列表随之变化。
- 内置插件在 `backend/plugins/`（107 个可用包 / 115 个 provider，另有 3 个 `src-*` 源目录镜像不参与运行），后台上传安装的落在 `MODEL_PLUGIN_INSTALL_DIR`。

### 18.5 调用记录 `/admin/api-logs`

`GET /admin/api-logs`（`model.call_read`）记录每次上游调用：`requestKind`（task / tool / test / proxy）、渠道、模型、协议、耗时、结果、`RouteAttempt.failureCode` 与错误摘要，可按状态 / 类型 / 渠道 / 任务 / 用户 / 模型筛选。用于回答「这次扣的是谁、走的是哪条线路、为什么失败」。

`GET /admin/api-logs/export`（`model.call_read + data.export` + 审计）导出同一筛选口径的 CSV；列表与导出共用一个查询构造函数，不会出现两个口径，导出**不含请求体 / 响应体**，上限 5000 行。路由必须声明在 `:id` 之前。

### 18.6 生成账单 `/admin/billing-orders` 与财务分析 `/admin/finance`

| 能力 | 接口 | 权限点 |
| --- | --- | --- |
| 账单列表 / 详情 | `GET /admin/billing-orders`、`/:id` | `billing_order.read` |
| 人工核对 | `POST /admin/billing-orders/:id/resolve`（`action: settle \| refund`，高危，自动审计） | `billing_order.resolve` |
| 财务汇总 | `GET /admin/analytics/finance` | `model.analytics_read` |

- 账单状态机：`reserved / running / settled / refunded / uncertain`。`uncertain`（超时、5xx、连接中断）不自动退款、不切线，只能人工 `settle` 或 `refund`，操作自动写审计。
- 财务口径固定三条：实收 = 已结算账单实际金额；已退 = 订单退款金额；净收入 = 实收 − 已退。预留 / 运行 / 待核对单列为「挂账」，**不计入实收**。

---

## 19. 能力管控 `/admin/capabilities`

`GET /admin/capabilities`（`capability.read`）、`PUT /admin/capabilities/:id`（`capability.write`，高危）。

- 16 项能力的上下线与原因；`CapabilityControl` 无行 = 启用。
- 下架后 C 端 `runtime.effective='disabled'`；`generate.service` 在**扣费之前**拦截并返回 `40005`，原因原样透传到 C 端。
- 只覆盖「上下线」这一层：能力的名称、分组、参数、默认价仍以 `definitions/<id>.ts` 为准，后台不能改代码里的 `mode`。
- 保存即 `invalidate()`，无需等缓存过期。

---

## 20. 数据备份与保留期清理

### 20.1 备份 `/admin/backups`

| 接口 | 说明 |
| --- | --- |
| `GET /admin/backups` / `:id` | 列表与详情 |
| `GET /admin/backups/stats` | 总量与最新一份 |
| `POST /admin/backups` | 手动备份（`backup.run`，高危） |
| `POST /admin/backups/:id/verify` | SHA-256 校验 |
| `GET /admin/backups/:id/download` | 下载 |
| `DELETE /admin/backups/:id` | 删除单份 |
| `POST /admin/backups/prune` | 按份数裁剪（自动写审计） |

- 产物落 `BACKUP_DIR`，单份带 SHA-256 供校验。
- 手动备份与保留份数裁剪均自动写审计，不要求填写变更原因；重复点击由前端 busy 状态防抖，不承诺跨请求幂等。
- 到期数据清理与清理留痕统一走 `/admin/retention/*`，不在备份控制器保留第二套入口。

### 20.2 保留期清理 `/admin/retention`

`GET /admin/retention/targets`（各目标默认可清理量）、`GET /admin/retention/preview?target=&retentionDays=`（按用户当前草稿天数重新计数）、`GET /admin/retention/logs`、`POST /admin/retention/cleanup`。执行结果落 `CleanupLog`；确认前必须按实际天数重新预览，避免「以为删的是过期日志，实际删了活跃文件」。

---

## 21. 数据工具

### 21.1 全局搜索

`GET /admin/search?q=`（`data.search`）：用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数。`q` 长度 < 2 直接返回空组——否则五个 `LIKE` 会全表扫描。落点按「哪个界面能立刻看到它」定：工单 `/admin/tickets?id=`、素材 `/admin/assets?q=<id>`。

### 21.2 导出

`/admin/{users,assets,tickets,orders,payments,credits}/export`（领域读权限 + `data.export`）。CSV 走 `common/csv.ts`，前端独立下载不走信封。

### 21.3 导入

`POST /admin/credits/import`（`credit.adjust`，multipart）。按邮箱匹配用户，逐行报结果。

### 21.4 批量

`/admin/{users,assets,tasks,orders}/batch`（使用各领域对应的动作权限），规则见 §0.7。

---

## 22. 后台与基础设施的交界

| 项 | 关系 |
| --- | --- |
| 健康检查 | `/health` 与 `/health/ready` 免登录，不经过后台守卫 |
| 限流 | 后台接口不额外限流；登录 / 注册的限流在 `RateLimitGuard` |
| 请求追踪 | 审计记录与日志都带 `requestId`，可用它串起「谁在什么时候点了什么」 |
| 日志 | `AppFileLogger` 落盘并脱敏，后台排障看 `.run` 之外的 `backend/logs/` |
| 环境 | 后台所有凭据类页面只读，改配置走 env（见 `docs/environments.md`） |

---

## 23. 告警中心 `/admin/alerts`

### 23.1 数据源与口径

`GET /admin/alerts`（只要求后台身份，来源在 service 内按角色权限过滤）。返回 `generatedAt`、`total` 与 `items[]`（`key` / `severity` / `category` / `title` / `detail` / `count` / `link`）。

| 来源 | 触发条件 | 升级为 `critical` | 所需权限 |
| --- | --- | --- | --- |
| 工单 | `status='open'` 数量 > 0（`processing` 已受理，不再告警） | 最早一条等待 ≥ 24 小时 | `ticket.read` |
| 任务失败 | 近 24 小时 `failed` > 0 | 失败 ≥ 10 个 | `task.read` |
| 任务积压 | `running` > 50 | — | `task.read` |
| 对账差异 | `status='open'` 的差异 > 0 | ≥ 5 笔 | `payment.read` |
| 退款卡单 | `Refund.status='processing'` 且创建超过 30 分钟（渠道异步退款、无回调） | 最早一笔 ≥ 24 小时 | `order.read` |
| 备份失败/过期 | 最近一次失败，或无成功备份超过 48 小时 | 最近一次失败 | `backup.read` |
| 备份未验证 | `succeeded && !verified` > 0 | — | `backup.read` |
| 发票 | `status='pending'` > 0 | — | `invoice.write` |

### 23.2 交互

- 顶栏铃铛显示待处理**条目数**（不是底层记录数），点击展开前 5 条，底部进完整页面；每 60 秒轮询，页面隐藏时跳过。
- 不引入「已读」状态：计数即「当前待处理数」，事项处理后自然消失，避免「点过就算解决」。
- 没有待处理项时不产生条目，也不显示 0 角标；接口失败保留上一次数据并给重试。
- `?status=open` / `?status=failed` / `?status=running` 直达对应列表筛选。
- 退款告警链接到 `/admin/orders?refundState=processing`；订单列表新增退款状态筛选（`processing` / `failed` / `succeeded`），筛选的是 `Refund` 行，订单本身可能仍是 `paid`。

---

## 24. 明确不做

| 项 | 原因 |
| --- | --- |
| 第三方内容安全送审台账 | 未接入就如实显示「未接入」，不做假审核记录；`content.read` 为预留权限点 |
| 公告中心 | 站内消息只覆盖定向通知与广播，不建公告定时发布与撤回 |
| 工单 SLA 计时 | 无客服排班与工时口径，建了只会给出假指标 |
| 独立审计存储 / hash 链 | 当前审计只读无删除接口，防篡改需独立存储，非本期范围 |
| 自定义角色 | 三个内置角色覆盖实际分工，权限点可调、角色不新增 |
| 数据分析看板 | 无漏斗 / 留存 / LTV 页面，概览只做现有表聚合 |
| 多租户与席位 | 单轨制，`User` 不加 `orgId` |
