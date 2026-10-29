# 后台管理端 · 详细设计

后台各模块的页面结构、接口、数据流与边界处理。本文只写**怎么做**，不重复**做什么**（功能与定位见 `docs/admin-console-design.md`，信息架构与 RBAC 见 `docs/admin-suite-design.md`，视觉规格见 `docs/admin-ui-design.md`）。

| 项 | 事实源 |
| --- | --- |
| 后端模块注册与守卫顺序 | `backend/src/admin/admin.module.ts` |
| 权限点与内置角色 | `backend/src/admin/permissions.ts` |
| 菜单分组 | `frontend/src/components/admin/adminNav.ts` |
| 通用组件与列表 hook | `frontend/src/components/admin/AdminWidgets.tsx` |
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
├── invoices-admin.controller.ts / reconciliation.controller.ts / reconciliation.service.ts
├── payment-channels.controller.ts
├── model.controller.ts / model-config.service.ts / model-call.service.ts
├── model-channel.controller.ts / model-channel.service.ts
├── capability.controller.ts
├── roles.controller.ts / settings.service.ts / settings.dto.ts
├── storage.controller.ts / scheduler.controller.ts / scheduler.service.ts
├── backup.controller.ts / backup.service.ts / retention.controller.ts
├── audit.controller.ts / audit.service.ts
└── search.controller.ts / search.service.ts

frontend/src/components/admin/
├── AdminLayout.tsx                  # 外壳（侧栏 + 顶栏 + 搜索 + 面包屑）
├── adminNav.ts                      # ADMIN_MENU 单一事实源
├── AdminWidgets.tsx                 # useAdminList / adminPagination / AdminDrawer / ConfirmAction 等
├── BatchResultModal.tsx             # 批量动作结果（失败项排最前）
└── PageHeader.tsx

frontend/src/pages/admin/            # 29 个页面 + modelConfig/ 子组件目录
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
| `AuditInterceptor` | 拦截 POST / PATCH / PUT / DELETE 写审计 | 不阻断业务，写失败只 WARN |

执行顺序：`AdminGuard` → `PermissionGuard` → controller → `AuditInterceptor`。三者内部对非 `/admin` 路径直接放行，C 端链路不受影响。

**为什么每次查库**：token TTL 7 天，若只信 token 内的角色，降权或禁用后旧 token 仍可用 7 天。SQLite 单文件、admin 接口低频，开销可忽略。

**审计口径**：

- 只记录 `POST / PATCH / PUT / DELETE`；GET 不落库。
- `detail` 只取白名单字段（`status` / `role` / `name` / `priceCents` / `reason` 等），命中 `password|token|secret|hash|credential` 的字段一律不写。
- 高危权限点要求请求体带 `reason`，落 `AdminAuditLog.reason`。
- 审计失败**不阻断业务**：让它阻断等于把审计变成单点故障，反而降低可追溯性。

### 0.3 权限点命名

`<模块>.<动作>`，54 个，完整清单见 `permissions.ts` 的 `PERMISSIONS`（分组表见 `docs/admin-suite-design.md` §2.2）。三条约束：

1. 权限点从清单移除后，角色里残留的值比对不上即等同无权（兜底默认拒），`AdminRoleService.getPermissions()` 读取时过滤；过滤只在内存生效，不回写库。
2. 三个内置角色不可删除，但权限点均可调整（含 `admin`）：`updatePermissions()` 只校验未知权限点与角色是否存在，不阻止裁剪；改动因守卫每次请求查库而立即生效。
3. 前端 `AdminContext.can()` 只隐藏按钮，**不是安全边界**。

### 0.4 列表页通用模式

`AdminWidgets.tsx` 的 `useAdminList` 统一处理分页、筛选、刷新与失败态：

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

`ConfirmAction`（antd `Modal` + `Alert` + 输入确认词）用于删除、退款、重置密码、手动调整积分、模型配置写入、角色与系统设置写入、备份。文案必须写明**影响量**（如「将删除 12 个素材」），不能只写「确定删除吗」。

### 0.7 批量动作

`common/batch.ts` 的 `runBatch(ids, handler)`：

- `ids` 去重，上限 100；
- **串行**执行，**不包事务**——一条失败不该回滚另外 99 条；
- 逐条返回 `{ id, ok, message?, data? }`；
- 前端 `BatchResultModal` 把失败项排在最前。

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
| GET | `/admin/users/:id/logins` | `user.read` |
| GET | `/admin/users/:id/impact` | `user.read` |
| PATCH | `/admin/users/:id/status` | `user.disable` |
| PATCH | `/admin/users/:id/role` | `user.write` |
| POST | `/admin/users/:id/password` | `user.reset_password` |
| DELETE | `/admin/users/:id` | `user.delete` |
| GET | `/admin/users/export` | `data.export` |
| POST | `/admin/users/batch` | `data.batch` |
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

- 详情抽屉给：输入素材缩略图、参数 JSON（`JSON.stringify(params, null, 2)`）、产出图、完整错误码、耗时。
- **重试不复用旧记录**：用原参数与原输入新建任务，再复用 `GenerateService.enqueue` 触发执行。原地复活会绕过 `GenerationTask.outputAssetId @unique` 的一产出约束。
- **终止**把 `running` 置 `failed` + `cancelled_by_admin`，按任务快照退款。
- 统计条显示各状态计数，积压（`pending` / `running`）超阈值标红。
- **导出** CSV 与列表共用 `listWhere`，筛什么导什么，上限 5000 行，需 `data.export` 并留审计。
- **性能**：能力 / 通道筛选项的全表 `groupBy` 缓存 60 秒；拥堵指标仍实时查询。`GenerationTask` 增加 `[status, createdAt]` 与 `[ownerId, createdAt]` 组合索引，服务「状态 + 时间窗」和用户详情时间线。
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
- 读 `legal.read`、写 `legal.write`；发布必填原因并写审计。

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
| 批量 / 导出 | `orders/batch` / `orders/export` | `data.batch` / `data.export` |

列表支持按退款状态筛选（`?refundState=processing|failed|succeeded`）。退款状态挂在 `Refund` 行上，一笔订单可能多次部分退款；告警中心正是用它把「渠道已受理但本地未落账」的订单捞出来。

### 10.3 退款顺序不可反

1. 硬约束校验：金额 ≤ 实付 − 已退（`40001`）。
2. 可配规则：时间窗 `40905`、比例 `40906`、积分已消耗且扣不回 `40907`。
3. 已有 `processing` 退款 → `40908`。
4. 落 `Refund(status='processing')`，用它的 id 作渠道幂等键 `outRefundNo`。
5. 调渠道：失败置 `failed` 并抛 `50302`，**订单状态与积分不变**，可重试；成功才回收积分、迁移订单状态、累加 `refundedCents`。

会员单全额退款终止会员周期（响应带 `membershipTerminated`）。**绝不允许「只改库、假装退过钱」**。

---

## 11. 支付与财务

### 11.1 支付渠道（只读）

`GET /admin/payment-channels`（`payment.read`）。数据直接复用 `PaymentProviderFactory.status()` 与 `PaymentsService.notifyUrl()`，不另写一套通道判定。展示生效通道、各通道凭据是否齐全、缺失变量名、回调地址，并对三类静默故障告警：

| 告警 | 后果 |
| --- | --- |
| 真实通道缺凭据 | 发起支付返回 503（绝不回落沙箱） |
| 生产仍走沙箱 | 真实收款不会到账 |
| 未配 `PAYMENT_NOTIFY_BASE` | 回调地址不可公网访问，订单卡在 pending |

页面无写端点：凭据只从环境变量读，切换通道须改 env 并重启。

### 11.2 发票

`/admin/invoices`（`invoice.write`）。一单一票（`orderId @unique`），金额取 `paidCents - refundedCents` 快照；输出可打印 HTML（零 PDF 依赖）。开具与驳回必填原因并写审计。`GET /admin/invoices/export` 导出同一 `status` / `keyword` 口径的 CSV（金额同时给分与元，`data.export` + 审计）。

### 11.3 渠道对账

`/admin/reconciliation`（`finance.reconcile`，只给财务）。

- CSV 解析手写 RFC4180 + 表头别名；金额单位按表头是否含 `cent|分` 判定。
- 差异五类：`matched` / `amount_mismatch` / `missing_local` / `missing_channel` / `duplicate`。
- **处置只改状态与备注，不改钱**。处置权只给财务：处置会让「账对不上」从看板上消失。
- 批次与明细可导出。

---

## 12. 积分账本 `/admin/credits`

`GET /admin/credits/...`（余额总览、批次、流水）、`POST /admin/credits/adjust`（`credit.adjust`）、`POST /admin/credits/import`（`data.import`）、`GET /admin/credits/export`。

- 余额 = `CreditLot` 未用完且未过期的批次之和。
- 消耗按 **FEFO**（先到期先扣，`NULL` 视为最晚到期）跨批次扣减；余额不足整体回滚并报 `40002`（前端按 402 语义处理）。
- 流水类型：`purchase` / `grant` / `consume` / `admin_adjust` / `expire` / `refund_reclaim`。人工增减必须填原因，落 `admin_adjust` 并写审计。
- CSV 导入按**邮箱**匹配用户，逐行返回结果（匹配不到、格式错误都单独报，不整批回滚）。

---

## 13. 营销

| 页面 | 接口 | 规则 |
| --- | --- | --- |
| 优惠券 | `/admin/coupons*`（`marketing.write`） | 满减 / 折扣 / 固定额；发放范围、门槛、有效期、每人限用、总量；核销走 `Order.couponId`；`GET /admin/coupons/export` 按同一筛选导出 CSV（`data.export` + 审计，路由在 `:id` 之前） |
| 限时活动 | `/admin/campaigns*` | 类型 `limited_price` / `limited_free` / `popup`；进行中的免活动让 `resolve()` 返回 0；到期由调度任务收尾；`GET /admin/campaigns/export` 按同一筛选导出 CSV（`data.export` + 审计） |
| 邀请与签到 | `/admin/invites*`、`/admin/checkin*` | 邀请奖励在被邀请人**首次付费**才触发；签到规则含基础积分与连签加成 |

C 端读取接口在 `marketing.controller.ts`（公开的 `/marketing/campaigns` 只回真正更便宜且在售的活动）。

---

## 14. 系统设置 `/admin/settings`

`GET|PATCH /admin/settings`（`setting.read` / `setting.write`）。默认值与键名只在 `settings.dto.ts` 的 `SETTING_DEFS` 定义，包括：站点信息、上传限制、生成超时与轮询、退款规则（`refund.windowDays` / `refund.maxRatioBps` / `refund.allowConsumedTask`）、备份频次与保留份数。

规则：

- 写入前按 `SETTING_DEFS` 做类型与范围校验，非法值整体拒绝。
- 退款规则的读取方是 `order.service.refund`，规则对象由后台控制器取好后传入，订单域不依赖 admin 层。
- 保存写审计；`setting.write` 属高危，必填原因。

### 14.1 角色权限 `/admin/roles`

`GET /admin/roles`（`audit.read`）返回三个内置角色的**库内实际权限点**（不是代码默认值，否则页面显示与实际不符）；`PATCH /admin/roles/:code/permissions`（`role.write`，高危，`AuditAction('role.permissions_update')`）。

规则：

- 角色不可增删改名，`builtIn` 恒为 `true`；三个角色的权限点都能改，包括 `admin`。
- 未知权限点整体拒绝（400 `40001`），不静默丢弃 —— 否则调用方会以为保存成功。
- 改动立即生效：`AdminGuard` / `PermissionGuard` 每次请求查库，不需要重启或重新登录。操作者把自己权限改没了也会当场生效（可由其他 admin 恢复）。
- 前端 `AdminRolesPage` 用 `can('role.write')` 控制可编辑态，按 54 个权限点分组勾选，高危权限点单独标注。

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

`GET /admin/audit-logs/export`（`data.export` + 审计）导出同一筛选口径的 CSV，详情列为 JSON；上限 5000 行。路由必须声明在 `:id` 之前。

导出与备份下载是 GET，但显式声明了 `@AuditAction`，`AuditInterceptor` 同样落审计 —— 把数据带出系统必须能回答「谁、何时、导了哪类数据」。

---

## 18. 模型配置与调用记录

### 18.1 模型配置 `/admin/model-config`

页签：线路管理 / 可用模型 / 逐能力路由 / 全局设置。

| 能力 | 接口 |
| --- | --- |
| 线路 CRUD、排序、启停 | `GET|POST|PATCH|DELETE /admin/model-channels*` |
| 单条 / 全部连通性测试 | `POST /admin/model-channels/test`、`/test-all`、`/:id/test` |
| 测草稿（未保存也可测） | `POST /admin/model-channels/test` 带草稿体 |
| 厂商实时模型清单 | `POST /admin/model-channels/models` |
| 旧版单体配置读写与测试 | `GET|PATCH /admin/model-config`、`POST /admin/model-config/test` |

规则：

- 某模态一旦有线路，旧版 `gateway.<modality>.*` 的 baseUrl / token / model / provider 不再参与调度（超时与轮询仍生效）。
- 模型清单两条来源：内置预设（`vendor.catalog.ts`，离线可用带中文说明）与厂商实时清单（用线路已保存令牌请求协议声明的 `modelListEndpoints`）。令牌只在请求内使用，不落库、不进审计。
- 保存后主动失效运行时缓存，不能等 3s 自然过期。
- 写 `channel.route` / `model.config_write`（admin 专属），测 `channel.test`（运营也有）。

### 18.2 调用记录 `/admin/model-calls`

`GET /admin/model-calls`、`/admin/model-calls/:id`（`model.call_read`）。记录线上每次通道调用：通道、模型、耗时、结果、失败原因与回落链路。用于回答「刚才走的是哪条线路」。

`GET /admin/model-calls/export`（`data.export` + 审计）导出同一筛选口径的 CSV（含提示词）；上限 5000 行。路由必须声明在 `:id` 之前。

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
| `POST /admin/backups/prune` | 按份数裁剪 |
| `POST /admin/backups/cleanup` | 触发清理日志 |
| `GET /admin/backups/cleanup-logs` | 清理日志 |

- 产物落 `BACKUP_DIR`，单份带 SHA-256 供校验。
- 路由声明顺序有意义：`cleanup-logs` 必须声明在 `:id` 之前，否则会被当成 id。
- 手动作业必填原因并写审计。

### 20.2 保留期清理 `/admin/retention`

`GET /admin/retention/targets`（各目标可清理量预览）、`GET /admin/retention/logs`、`POST /admin/retention/cleanup`。执行结果落 `CleanupLog`；先预览再执行，避免「以为删的是过期日志，实际删了活跃文件」。

---

## 21. 数据工具

### 21.1 全局搜索

`GET /admin/search?q=`（`data.search`）：用户 / 订单 / 工单 / 任务 / 素材五组各前 5 条 + 总数。`q` 长度 < 2 直接返回空组——否则五个 `LIKE` 会全表扫描。落点按「哪个界面能立刻看到它」定：工单 `/admin/tickets?id=`、素材 `/admin/assets?q=<id>`。

### 21.2 导出

`/admin/{users,assets,tickets,orders,payments,credits}/export`（`data.export`）。CSV 走 `common/csv.ts`，前端独立下载不走信封。

### 21.3 导入

`POST /admin/credits/import`（`data.import`，multipart）。按邮箱匹配用户，逐行报结果。

### 21.4 批量

`/admin/{users,assets,tasks,orders}/batch`（`data.batch`），规则见 §0.7。

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
